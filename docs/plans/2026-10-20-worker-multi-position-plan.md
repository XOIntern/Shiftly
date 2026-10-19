# Worker Multi-Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one worker hold a set of positions (minimum one) instead of a single `position_id`, with DB-enforced same-site integrity, updated CRUD UI, and position delete guards that read the new pivot.

**Architecture:** New `worker_position` pivot (`worker_id`, `position_id`, denormalized `site_id`) with two composite FKs onto `worker(id, site_id)` and `position(id, site_id)`. Shipped as expand → contract: migration `0015` adds the table and backfills while `worker.position_id` survives; the read/write path moves to the pivot (dual-writing the placeholder); migration `0016` drops the column. Actions replace the set inside one transaction in the fixed order delete → update worker → insert, because the composite FK forbids changing `worker.site_id` while stale pivot rows exist.

**Tech Stack:** Next.js 16 App Router server components/actions, Drizzle ORM + drizzle-kit, PostgreSQL 18 (compose), zod, Bun test runner, shadcn/ui (base-nova, Base UI Checkbox).

**Spec:** `docs/specs/2026-10-20-worker-multi-position-design.md`

## Global Constraints

- Bun only: `bun install`, `bun test`, `bun run lint`, `bun run build`, `bun run db:generate`, `bun run db:migrate` — never npm/yarn/pnpm.
- DB-backed tests need the compose Postgres: `docker compose up -d`.
- Exact copy, verbatim: `"Select each position once"` (duplicate ids), `"Position is required"` (form pre-submit), `"Position must be in the same site as the location"` (set check), `"Selected location or position no longer exists"` (FK net), `"Some workers still reference this position"` (guard), `"Worker not found."`, `"Invalid worker id."`, `"Employee ID already in use in this location"`.
- A worker holds **0..n positions in the data model but the validator and form require ≥ 1**; there is no primary, no ordering, and no positional semantics anywhere.
- Same-site pairing is a DB guarantee (composite FKs), never app-only. `siteId` is never an action input; it is derived from the live `site_location`.
- Inactive positions: attached ones are preserved and rendered; only active ones are offered for new picks. The server accepts inactive (live + same-site) on write.
- Update order inside the transaction is fixed: delete the worker's pivot rows → update the worker (welded WHERE) → insert the new set. Reversing it trips the composite FK.
- Migration order is fixed: unique constraint → `CREATE TABLE` → index → backfill (`0015`); drop constraint → drop column (`0016`). Hand-edit generated SQL and commit `drizzle/migrations/meta/_journal.json` with the SQL.
- Test fixture name prefixes: new cases use `t20-mp-`; existing suites keep `t10-`/`t11-`/`t12-`/`t13-` (shared dev DB). Site names embed their uuid so alphabetical defaults hold.
- Actions/component mocks follow the existing patterns: `mock.module("@/lib/session", …)` stubs every export (`getUser`, `requireUser`, `requireHO`, `requireSuperadmin`); `mock.module("next/cache", …)` stubs `revalidatePath`; component SSR tests mock `next/navigation`.
- Never stage or commit globally-ignored files; run `git check-ignore -v <path>` before `git add` on any unfamiliar path.

## Review Focus

Failure modes the spec implies; each is pinned by a test in the owning task.

1. An edit that never touches positions must not lose one that was deactivated since the picker snapshot — pinned by Task 2 test `update with an attached inactive position: succeeds and keeps it` and the form test `an attached inactive position renders with (inactive)`.
2. A superadmin cross-site move must rewrite every pivot row's `site_id`, leaving no row pointing at the old site — pinned by Task 2 test `superadmin cross-site move rewrites the pivot site_id`.
3. An empty set must be rejected server-side even if the UI guard is bypassed — pinned by Task 2 tests `create with an empty set: rejected` and `update with an empty set: rejected`.
4. A foreign or vanished worker must answer "Worker not found." without touching its pivot rows — pinned by Task 2 test `update on a foreign worker: not found, pivot untouched`.
5. The position delete guard must ignore pivot rows belonging to soft-deleted workers — pinned by Task 3 test `soft-deleted worker does not block the position delete`.

---

### Task 1: Expand — pivot table, migration 0015, FK integrity

**Files:**
- Modify: `drizzle/schema/worker-schema.ts`
- Generate: `drizzle/migrations/0015_*.sql` + `drizzle/migrations/meta/_journal.json`
- Modify: `lib/worker-fk.test.ts`

**Interfaces:**
- Consumes: `position` and `site` tables, `siteLocation` from `./site-schema` (unchanged).
- Produces: `workerPosition` (`workerId`, `positionId`, `siteId`, `createdAt`), `workerPositionRelations` (`one(worker)`, `one(position)`), `workerRelations.positions: many(workerPosition)`, and the `worker_id_site_id_unique` constraint. Task 2 imports `workerPosition` from `@/drizzle/schema`.

- [ ] **Step 1: Add the failing pivot tests to `lib/worker-fk.test.ts`**

New `describe("worker_position composite-FK & PK guards (multi-position spec, 2026-10-20)")` with these tests (fixtures prefixed `t20-mp-`; each test cleans up child-first: pivot → worker → position → location → site):

```ts
test("position from site B + pivot site_id = A: rejected with 23503");
test("pivot site_id that does not match the worker's site: rejected with 23503");
test("duplicate (worker, position) pair: rejected with 23505");
test("valid same-site pair: inserts");
```

Seed pattern: sites A/B, location LA under A, positions PA under A and PB under B, a worker in A (still carrying `positionId: PA`, required until migration `0016`). The valid case inserts `{ workerId, positionId: PA, siteId: siteA }`; the cross-site case uses `PB` with `siteId: siteA`; the mismatch case uses `PA` with `siteId: siteB`; the duplicate case inserts the same pair twice and expects `23505`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose up -d && bun test lib/worker-fk.test.ts`
Expected: FAIL — `workerPosition` is not exported / relation does not exist.

- [ ] **Step 3: Extend `drizzle/schema/worker-schema.ts`**

Add `index`, `primaryKey`, `unique` to the `pg-core` imports and append to the `worker` table's constraint list:

```ts
unique("worker_id_site_id_unique").on(table.id, table.siteId),
```

Then add, after `worker`:

```ts
export const workerPosition = pgTable(
  "worker_position",
  {
    workerId: uuid("worker_id").notNull(),
    positionId: uuid("position_id").notNull(),
    siteId: uuid("site_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workerId, table.positionId] }),
    index("worker_position_position_id_idx").on(table.positionId),
    foreignKey({
      name: "worker_position_worker_site_fk",
      columns: [table.workerId, table.siteId],
      foreignColumns: [worker.id, worker.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "worker_position_position_site_fk",
      columns: [table.positionId, table.siteId],
      foreignColumns: [position.id, position.siteId],
    }).onDelete("restrict"),
  ],
);
```

Update relations: `workerRelations` destructures `({ one, many })` and adds `positions: many(workerPosition)`; add `workerPositionRelations = relations(workerPosition, ({ one }) => ({ worker: one(worker, …), position: one(position, …) }))`. Keep everything in this file (one-way dependency, no cycles).

- [ ] **Step 4: Generate and hand-order migration `0015`**

Run: `bun run db:generate`. Open the new `drizzle/migrations/0015_*.sql` and make it read exactly (names must match the generated ones):

```sql
ALTER TABLE "worker" ADD CONSTRAINT "worker_id_site_id_unique" UNIQUE("id","site_id");
CREATE TABLE "worker_position" (
  "worker_id" uuid NOT NULL,
  "position_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "worker_position_worker_id_position_id_pk" PRIMARY KEY("worker_id","position_id"),
  CONSTRAINT "worker_position_worker_site_fk" FOREIGN KEY ("worker_id","site_id") REFERENCES "public"."worker"("id","site_id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "worker_position_position_site_fk" FOREIGN KEY ("position_id","site_id") REFERENCES "public"."position"("id","site_id") ON DELETE restrict ON UPDATE no action
);
CREATE INDEX "worker_position_position_id_idx" ON "worker_position" USING btree ("position_id");
INSERT INTO "worker_position" ("worker_id","position_id","site_id")
  SELECT "id","position_id","site_id" FROM "worker";
```

The unique constraint **must** precede `CREATE TABLE` (the composite FK resolves against it). The backfill must follow the table. `worker.position_id` is not dropped here.

- [ ] **Step 5: Apply the migration**

Run: `bun run db:migrate`
Expected: applies `0015` with no error.

- [ ] **Step 6: Verify the backfill**

Run the count query from the spec §3.4 against `DATABASE_URL` (psql or a one-off `bun -e`), expecting `0` workers without a pivot row.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test lib/worker-fk.test.ts`
Expected: PASS — all pre-existing worker FK tests plus the four new pivot tests.

- [ ] **Step 8: Commit**

```bash
git add drizzle/schema/worker-schema.ts drizzle/migrations/0015_*.sql drizzle/migrations/meta/_journal.json lib/worker-fk.test.ts
git commit -m "feat(workers): worker_position pivot with same-site composite FKs"
```

---

### Task 2: Move the read/write path to the set

**Files:**
- Modify: `schema/validators.ts`, `schema/validators.test.ts`
- Modify: `app/dashboard/workers/actions.ts`, `app/dashboard/workers/actions.test.ts`
- Modify: `app/dashboard/workers/page.tsx`, `app/dashboard/workers/page.test.ts`
- Modify: `types/forms.ts`
- Modify: `components/workers/worker-form.tsx`, `components/workers/worker-form.test.tsx`
- Modify: `components/workers/workers-table.tsx`, `components/workers/workers-table.test.tsx`

**Interfaces:**
- Consumes: Task 1's `workerPosition`; `fieldErrorsFrom` key rule (array issues land on `"positionIds"`).
- Produces:
  - `workerCreateSchema`: `{ siteId?: string; siteLocationId: string; positionIds: string[]; employeeId: string; name: string; contractEndDate?: string }`; `workerUpdateSchema` adds `{ id: string; isActive: boolean }`.
  - `createWorker(input: { siteLocationId?: string; positionIds: string[]; employeeId: string; name: string; contractEndDate?: string }): Promise<ActionState>`.
  - `updateWorker(id: string, input: { siteLocationId?: string; positionIds: string[]; employeeId: string; name: string; contractEndDate?: string; isActive: boolean }): Promise<ActionState>`.
  - `WorkerRow = { id; employeeId; name; isActive; contractEndDate: string | null; siteLocationId; siteId; siteName; locationName; positions: { id: string; name: string; isActive: boolean }[] }`.
  - `visiblePositionOptions(positions: PositionRow[], siteId: string | null, selectedIds: string[]): PositionRow[]` exported from `worker-form.tsx`.

- [ ] **Step 1: Write the failing validator tests**

Append to `schema/validators.test.ts` (new `describe("workerCreateSchema positionIds")`):

```ts
test("accepts two distinct uuid positions");
test("rejects an empty array with a positionIds message");
test("rejects duplicate ids with 'Select each position once'");
```

Assert the empty/duplicate failures land on `result.error.issues[0].path.join(".") === "positionIds"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test schema/validators.test.ts`
Expected: FAIL — `positionIds` is unknown to the schema (the current schema requires `positionId`).

- [ ] **Step 3: Implement the validator change**

In `workerCreateSchema`, replace `positionId: z.uuid()` with:

```ts
positionIds: z
  .array(z.uuid())
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Select each position once",
  }),
```

Update the schema comment (a worker holds one or more positions of its own site). `workerUpdateSchema` inherits it.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test schema/validators.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the failing action tests**

In `app/dashboard/workers/actions.test.ts`: change every `positionId` payload to `positionIds: [id]`, add `workerPosition` to imports, and add these tests (names verbatim):

```ts
test("create with two positions persists both");
test("create with an empty set: rejected");
test("create with duplicate ids: rejected with 'Select each position once'");
test("update replaces the position set");
test("update with an empty set: rejected");
test("superadmin cross-site move rewrites the pivot site_id");
test("ho cross-site move: rejected, pivot untouched");
test("update on a foreign worker: not found, pivot untouched");
test("update with an attached inactive position: succeeds and keeps it");
```

Assertions: after create/update read `worker_position` joined to `position`, assert the id set and name order; the cross-site test asserts every row's `siteId` equals the new site and no old position id survives; the foreign test asserts `result.message === "Worker not found."` and the pivot rows are unchanged.

- [ ] **Step 6: Run them to verify they fail**

Run: `bun test app/dashboard/workers/actions.test.ts`
Expected: FAIL — the actions still read `positionId`.

- [ ] **Step 7: Implement the action changes**

In `app/dashboard/workers/actions.ts`:

1. Imports: add `workerPosition`; add `inArray` from `drizzle-orm`.
2. Replace `loadAndCheckPosition` with:

```ts
type PositionsCheck = { ok: true } | { fieldError: string };

async function loadAndCheckPositions(
  ids: string[],
  siteId: string,
): Promise<PositionsCheck>
```

It selects `{ id, siteId }` from `position` where `inArray(position.id, ids)` and `isNull(position.deletedAt)`; returns the shared field error when any id is missing or any row's `siteId !== siteId`. Inactive rows are accepted.

3. `createWorker`/`updateWorker` input and parse switch to `positionIds`; on failure return `fieldErrorsFrom`.
4. `createWorker` runs inside `db.transaction`: insert the worker with `positionId: parsed.data.positionIds[0]` (temporary placeholder until Task 4, with a comment naming migration `0016`), `returning({ id })`, then `tx.insert(workerPosition).values(positionIds.map((positionId) => ({ workerId: row.id, positionId, siteId: derivedSiteId })))`.
5. `updateWorker` runs inside `db.transaction` in this exact order: `tx.delete(workerPosition).where(eq(workerPosition.workerId, id))` → `tx.update(worker).set({ siteLocationId, siteId: derivedSiteId, positionId: parsed.data.positionIds[0], employeeId, name, contractEndDate, isActive }).where(workerMutationWhere(actor, id)).returning({ id })` → if zero rows return `{ notFound: true }` from the callback (rolls the delete back) → insert the new pivot set. After the transaction, map `notFound` to `"Worker not found."`.
6. Comment that `deleteWorker` leaves pivot rows in place and guards join live workers; drop the "workers have no children" wording from `deleteWorker`/`deleteBulk` comments.

- [ ] **Step 8: Run them to verify they pass**

Run: `bun test app/dashboard/workers/actions.test.ts`
Expected: PASS.

- [ ] **Step 9: Update the failing page tests**

In `app/dashboard/workers/page.test.ts`: seed pivot rows for every directly inserted worker, add `positions` to the collected worker row type, and add:

```ts
test("each row carries its positions sorted by name");
test("a worker with no pivot rows renders an empty positions list");
test("position options include inactive positions");
```

- [ ] **Step 10: Run them to verify they fail**

Run: `bun test app/dashboard/workers/page.test.ts`
Expected: FAIL — rows have no `positions` prop; options are filtered to active.

- [ ] **Step 11: Implement the types and page**

- `types/forms.ts`: replace `positionId`/`positionName` on `WorkerRow` with `positions: { id: string; name: string; isActive: boolean }[]`.
- `app/dashboard/workers/page.tsx`: remove the `innerJoin(position, …)` from the worker query (keep the site/location joins); after the page query, when the page is non-empty, run the follow-up query shown in spec §6.1, order by `asc(position.name)`, group into a `Map<string, WorkerRow["positions"]>`, and attach `positions: map.get(row.id) ?? []`. Remove `eq(position.isActive, true)` from the options query (keep `isNull(position.deletedAt)` and the existing role scope).

- [ ] **Step 12: Run them to verify they pass**

Run: `bun test app/dashboard/workers/page.test.ts`
Expected: PASS.

- [ ] **Step 13: Update the failing component tests**

- `worker-form.test.tsx`: replace `positionId`/`positionName` in the `editWorker` fixture with `positions: [{ id: POS_A1, name: "Position Alpha One", isActive: true }]`; update the cascade assertions to expect the checkbox group instead of `>Select a position<`; add:

```ts
test("an edit with two attached positions renders both checked");
test("an attached inactive position renders with (inactive)");
test("an inactive position that is not attached is not rendered");
test("visiblePositionOptions unions candidates with attached inactive rows");
```

For checked assertions use the verified Base UI markup: `(html.match(/aria-checked="true"/g) ?? []).length`.

- `workers-table.test.tsx`: replace the `positionId`/`positionName` fixture fields with `positions: [{ id: POS_A1, name: "Position Alpha One", isActive: true }]`; add `test("renders every position name joined with a comma")`.

- [ ] **Step 14: Run them to verify they fail**

Run: `bun test components/workers/worker-form.test.tsx components/workers/workers-table.test.tsx`
Expected: FAIL — the form still renders a single Select; the table reads `positionName`.

- [ ] **Step 15: Implement the form and table**

`worker-form.tsx`:

- State `positionIds: string[]` prefilled from `worker?.positions.map((p) => p.id) ?? []`.
- Export:

```ts
export function visiblePositionOptions(
  positions: PositionRow[],
  siteId: string | null,
  selectedIds: string[],
): PositionRow[]
```

Returns `positionOptionsFor(positions, siteId)` plus any same-site position whose id is in `selectedIds` and is not already a candidate, sorted by name.

- Replace the position `SelectField` with a `Field` containing `FieldLabel` "Positions" and a scrollable `max-h-48 overflow-y-auto` list of `<label key={id} className="flex items-center gap-2">` rows, each `<Checkbox checked={positionIds.includes(id)} onCheckedChange={…} />` plus the name and `" (inactive)"` when `!isActive`. Toggle = add/remove the id. `data-invalid` + `FieldError` keyed on `fieldErrors.positionIds`.
- Site change clears `positionIds`; location change clears them only when the resolved site changes.
- Pre-submit: `positionIds.length === 0` → `setFieldErrors({ positionIds: "Position is required" })`, no server call.
- Payload: `positionIds`.
- Dialog copy per spec §7.

`workers-table.tsx`: Position column renders `row.positions.map((p) => p.name).join(", ") || "–"`.

- [ ] **Step 16: Run them to verify they pass**

Run: `bun test components/workers/worker-form.test.tsx components/workers/workers-table.test.tsx`
Expected: PASS.

- [ ] **Step 17: Full verification**

Run: `bun run lint && bun test && bun run build`
Expected: all green (the whole repo, including untouched suites).

- [ ] **Step 18: Commit**

```bash
git add schema/validators.ts schema/validators.test.ts app/dashboard/workers/actions.ts app/dashboard/workers/actions.test.ts app/dashboard/workers/page.tsx app/dashboard/workers/page.test.ts types/forms.ts components/workers/worker-form.tsx components/workers/worker-form.test.tsx components/workers/workers-table.tsx components/workers/workers-table.test.tsx
git commit -m "feat(workers): read and write the worker position set"
```

---

### Task 3: Position delete guards read the pivot

**Files:**
- Modify: `app/dashboard/positions/actions.ts`
- Modify: `app/dashboard/positions/bound-guard.test.ts`
- Modify: `app/dashboard/positions/bulk.test.ts` (only if it seeds workers)

**Interfaces:**
- Consumes: `workerPosition` and `worker` from `@/drizzle/schema`; the `applied`/`blocked` `ActionState` shape.
- Produces: no new exports — `deletePosition(id)` and `deleteBulk(ids)` keep their signatures and messages.

- [ ] **Step 1: Update the failing guard tests**

In `bound-guard.test.ts`, seed workers with both `positionId` (temporary, until Task 4) and a `workerPosition` row; add:

```ts
test("a worker holding the position among several blocks the delete");
test("soft-deleted worker does not block the position delete");
```

In `bulk.test.ts`, extend the split test so one blocked position is held by a two-position worker; keep the `applied/blocked` assertions.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test app/dashboard/positions/bound-guard.test.ts app/dashboard/positions/bulk.test.ts`
Expected: FAIL — the guard still counts `worker.position_id`.

- [ ] **Step 3: Implement the pivot joins**

- `deletePosition`: select `count()` from `workerPosition` inner-joined to `worker` on `worker.id = workerPosition.workerId`, where `workerPosition.positionId = id` and `isNull(worker.deletedAt)`. Keep the message.
- `deleteBulk`: the grouped count selects `workerPosition.positionId` and `count()`, joined the same way, filtered by `inArray(workerPosition.positionId, batchIds)` and `isNull(worker.deletedAt)`, grouped by `workerPosition.positionId`. Everything else (scope intersection, `freeIds`, counters) is unchanged.

- [ ] **Step 4: Run them to verify they pass**

Run: `bun test app/dashboard/positions/bound-guard.test.ts app/dashboard/positions/bulk.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/positions/actions.ts app/dashboard/positions/bound-guard.test.ts app/dashboard/positions/bulk.test.ts
git commit -m "feat(positions): bound delete guard on worker_position"
```

---

### Task 4: Contract — drop `worker.position_id` + docs

**Files:**
- Modify: `drizzle/schema/worker-schema.ts`
- Generate: `drizzle/migrations/0016_*.sql` + `drizzle/migrations/meta/_journal.json`
- Modify: `app/dashboard/workers/actions.ts`
- Modify: every test that inserts `positionId` into `worker` (`lib/worker-fk.test.ts`, `app/dashboard/workers/*.test.ts`, `app/dashboard/positions/*.test.ts`, any others found by grep)
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: the final schema — `worker` has no `position_id`; no code writes it.

- [ ] **Step 1: Remove the column from the schema**

Delete the `positionId` field and the `worker_position_site_fk` `foreignKey(...)` entry from the `worker` table in `drizzle/schema/worker-schema.ts`; update the header comment to describe the pivot as the qualification set. Run `bun run db:generate`.

- [ ] **Step 2: Verify migration `0016`**

The generated SQL must drop the old FK before the column:

```sql
ALTER TABLE "worker" DROP CONSTRAINT "worker_position_site_fk";
ALTER TABLE "worker" DROP COLUMN "position_id";
```

Reorder if the generator differs. Then `bun run db:migrate`.

- [ ] **Step 3: Remove the dual-write and every `positionId` writer**

- `app/dashboard/workers/actions.ts`: delete `positionId: parsed.data.positionIds[0]` from the create insert and the update `.set(...)`; delete the temporary comments.
- Grep the repo for `positionId` and remove it from every `db.insert(worker)` fixture and `worker` update; keep `positionId` wherever it means `workerPosition.positionId` or a validator/action payload key. The only surviving payload key is `positionIds`.
- Re-run `bun run db:generate` to confirm there is no schema diff left.

- [ ] **Step 4: Run the full suite**

Run: `bun run lint && bun test && bun run build`
Expected: all green; the DB-backed suites prove no code path still writes the dropped column.

- [ ] **Step 5: Update the architecture doc**

In `docs/architecture.md`:

- Add a revision note: a worker holds a **set** of positions via `worker_position` (each row site-welded by composite FKs); there is no primary position.
- Add `worker`, `position`, and `worker_position` to the "Implemented so far" list in §6.
- Keep C8 marked dormant; state that assignment-side qualification requirements are still out of scope.

- [ ] **Step 6: Commit**

```bash
git add drizzle/schema/worker-schema.ts drizzle/migrations/0016_*.sql drizzle/migrations/meta/_journal.json app/dashboard/workers/actions.ts lib/worker-fk.test.ts app/dashboard/workers app/dashboard/positions docs/architecture.md
git commit -m "feat(workers): drop worker.position_id after the pivot cutover"
```

---

## Execution notes

- Tasks 1→2→3→4 are strictly ordered: Task 2 reads the pivot backfilled by Task 1, Task 3 guards the rows Task 2 writes, and Task 4 removes the column only after no writer remains.
- The `{ notFound: true }` sentinel in `updateWorker` covers a race between the ownership pre-check and the transaction; it is defensive and not directly testable without interleaving.
- If `bun run db:generate` emits the unique constraint after `CREATE TABLE` in `0015`, the migration fails — reorder as pinned in Task 1 Step 4.
