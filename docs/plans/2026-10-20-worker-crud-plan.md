# Worker CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/dashboard/workers` stub with full-parity CRUD (search/sort/pagination/filter, create/edit dialogs, toggle, soft delete, bulk) over the #83 `worker` table, plus the position bound-guard upgrade.

**Architecture:** New `lib/worker-scope.ts` + `app/dashboard/workers/actions.ts` mirror the position/work-area patterns (per-role fail-closed scoping, ownership weld inside the mutating WHERE). `site_id` is never a client input — it is derived from the live site_location on every write, so "moving" a worker (any field, any site, superadmin-only in effect) is just choosing a new location. UI mirrors `positions-table.tsx` + `work-area-form.tsx` with a site → location → position cascade.

**Tech Stack:** Next.js App Router server components/actions, Drizzle ORM, PostgreSQL 18 (compose), zod, Bun test runner, shadcn/ui (base-nova), @tanstack/react-table.

**Spec:** `docs/specs/2026-10-20-worker-crud-design.md`

## Global Constraints

- Bun only: `bun install`, `bun test`, `bun run lint`, `bun run build` — never npm/yarn/pnpm.
- DB-backed tests need the compose Postgres up: `docker compose up -d`.
- Exact copy, verbatim (pinned by the spec §5–§9): `"Employee ID already in use in this location"` (23505 mapping), `"Selected location or position no longer exists"` (FK net), `"Location must be in your site"` (ho scope field error), `"Position must be in the same site as the location"` (position check field error), `"Worker not found."` (foreign/missing row), `"Some workers still reference this position"` (bound guard), `"Invalid worker id."` (malformed uuid).
- `siteId` is NEVER an action input: derived from the live `site_location` server-side (`deriveSiteId` pattern). Validators keep `siteId: z.uuid().optional()` for shape parity with workArea/position schemas; the actions ignore it.
- Admin scoping welds on `site_location_id` (NOT the binding's site — workers are location-level data); ho welds on `site_id`; superadmin unscoped; unbound actor → `sql\`false\``.
- Position picker offers only live+active positions; the server tolerates inactive positions on write (live + same-site only) so an edit never fails because a position was deactivated since.
- Test fixture name prefixes per suite (shared dev DB): `t10-wscope-` (worker-scope.test.ts), `t11-wact-` (actions.test.ts), `t12-wbg-` (bound-guard.test.ts), `t13-wpage-` (page.test.ts); site names embed their uuid so alphabetical defaults hold.
- Actions mocks follow `positions/bulk.test.ts`: `mock.module("@/lib/session", …)` + `mock.module("next/cache", …)` — every `@/lib/session` export stubbed.
- Never stage or commit globally-ignored files; verify unfamiliar paths with `git check-ignore -v <path>` before `git add`.

## Review Focus

Failure modes the spec implies; each is pinned by a test in the owning task.

1. A ho "moving" a worker by submitting another site's location must be rejected — pinned by Task 2 test `ho update to another site's location: rejected with scope field error`.
2. An edit that never touches the position must not fail when that position is inactive — pinned by Task 2 test `update with inactive position: succeeds`.
3. Moving a worker onto a duplicate `employee_id` in the target location must surface the friendly 23505 mapping — pinned by Task 2 test `move onto duplicate employee_id in target location: 23505 mapped`.
4. Deleting a position with live workers must be blocked, and freed again after the workers soft-delete — pinned by Task 3 tests.
5. Unbound admin/ho must see nothing and fail closed on mutation (no scope leak) — pinned by Task 1 scope tests and Task 6 page test `unbound admin sees nothing`.

---

### Task 1: Worker scope guards, validators, types

**Files:**
- Create: `lib/worker-scope.ts`
- Create: `lib/worker-scope.test.ts` (pattern: `lib/work-area-scope.test.ts`)
- Modify: `schema/validators.ts` (append worker schemas + input type exports)
- Modify: `types/forms.ts` (add `WorkerRow`)
- Modify: `types/db-error.ts` (extend `DbErrorKind`, `DUPLICATE_MESSAGES`)

**Interfaces:**
- Consumes: `worker` from `../drizzle/schema`; `db` from `./db`; the `ScopedActor` shape `{ role: "superadmin" | "ho" | "admin"; siteId: string | null; siteLocationId: string | null }`.
- Produces: `workerOwnedByActor(actor: ScopedActor, id: string): Promise<boolean>`; `workerMutationWhere(actor: ScopedActor, id: string): SQL | undefined`; `workerBulkMutationWhere(actor: ScopedActor, ids: string[]): SQL | undefined` — exact same contracts as `work-area-scope.ts` with the admin branch on `worker.siteLocationId`. `workerCreateSchema` / `workerUpdateSchema` + `WorkerCreateInput` / `WorkerUpdateInput` exports. `WorkerRow` type: `{ id, employeeId, name, isActive, contractEndDate: string | null, siteLocationId, positionId, siteId, siteName, locationName, positionName }`. `DbErrorKind` gains `"worker-employee-id"`.

- [ ] **Step 1: Write the failing test `lib/worker-scope.test.ts`**

DB-backed, mirroring `lib/work-area-scope.test.ts` (fixtures `t10-wscope-`, uuid-embedded site names, child-first cleanup, real `requireUser`-shaped actors passed directly — no session mock needed for a pure lib). Cases:

```ts
describe("worker scope guards", () => {
  test("superadmin owns every worker");
  test("ho owns only workers under their site");
  test("admin owns only workers in their binding location");
  test("unbound admin owns nothing");
  test("workerMutationWhere welds the admin binding: foreign row untouched");
});
```

The weld test: as an admin bound to site A's location, `db.update(worker).set({ name: … }).where(workerMutationWhere(actor, workerInSiteB.id))` returns 0 rows and the foreign row's name is unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose up -d && bun test lib/worker-scope.test.ts`
Expected: FAIL — module `./worker-scope` does not exist.

- [ ] **Step 3: Implement `lib/worker-scope.ts` + validators + types**

Copy `lib/work-area-scope.ts` verbatim, rename to `worker`/`workerMutationWhere`/`workerBulkMutationWhere`/`workerOwnedByActor`; the admin branch compares `worker.siteLocationId === actor.siteLocationId`. In `schema/validators.ts` append (after the position block, same comment style):

```ts
export const workerCreateSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid(),
  positionId: z.uuid(),
  employeeId: z.string().trim().min(1).max(100),
  name: nameField,
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const workerUpdateSchema = workerCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});
export type WorkerCreateInput = z.infer<typeof workerCreateSchema>;
export type WorkerUpdateInput = z.infer<typeof workerUpdateSchema>;
```

In `types/forms.ts` add `WorkerRow` per the Interfaces block (all joined names non-null: required inner joins). In `types/db-error.ts` extend `DbErrorKind` with `"worker-employee-id"` and `DUPLICATE_MESSAGES` with `worker-employee-id: "Employee ID already in use in this location"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test lib/worker-scope.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/worker-scope.ts lib/worker-scope.test.ts schema/validators.ts types/forms.ts types/db-error.ts
git commit -m "feat(workers): worker scope guards, validators, and row types"
```

---

### Task 2: Worker server actions

**Files:**
- Create: `app/dashboard/workers/actions.ts`
- Create: `app/dashboard/workers/actions.test.ts` (pattern: `positions/bulk.test.ts`)

**Interfaces:**
- Consumes: Task 1's `workerOwnedByActor` / `workerMutationWhere` / `workerBulkMutationWhere` / `workerCreateSchema` / `workerUpdateSchema` / `"worker-employee-id"` kind; `worker, siteLocation, position` from `@/drizzle/schema`; `requireUser` from `@/lib/session`; `fieldErrorsFrom, GENERIC_ERROR` from `@/lib/action-state`; `mapDbError, pgErrorCode` from `@/lib/db-errors`.
- Produces: `createWorker(input: { siteLocationId?: string; positionId?: string; employeeId: string; name: string; contractEndDate?: string }): Promise<ActionState>`; `updateWorker(id: string, input: { siteLocationId?: string; positionId?: string; employeeId: string; name: string; contractEndDate?: string; isActive: boolean }): Promise<ActionState>`; `toggleWorker(id: string): Promise<ActionState>`; `deleteWorker(id: string): Promise<ActionState>`; `setActiveBulk(ids: string[], isActive: boolean): Promise<ActionState>`; `deleteBulk(ids: string[]): Promise<ActionState>` (worker `blocked` always 0 — no children). Task 4's form imports these exact names.

- [ ] **Step 1: Write the failing test `app/dashboard/workers/actions.test.ts`**

Mock pattern from `positions/bulk.test.ts` (module-level `let actor: SessionUser`; stub all four session exports; stub `next/cache`). Fixtures per test: sites A/B, locations (LA1, LA2 on site A; LB on site B), positions (PA on site A, PB on site B), workers seeded directly through `db.insert(worker)` with consistent `siteId`. Tests (names verbatim):

```ts
describe("worker actions", () => {
  test("superadmin create derives site from the location: round-trips");
  test("ho create with another site's location: rejected with scope field error");
  test("admin create is pinned to their binding location and site's positions");
  test("create with a position from another site: rejected with same-site field error");
  test("create duplicate employee_id in one location: mapped 23505 message");
  test("ho update to another site's location: rejected with scope field error");
  test("superadmin update moves the worker across sites and positions");
  test("update with inactive position: succeeds");
  test("move onto duplicate employee_id in target location: 23505 mapped");
  test("toggle and delete weld the scope: foreign worker answers not found");
  test("delete frees the employee_id in the location");
  test("bulk actions apply only in-scope ids");
});
```

Key assertions: create round-trip checks `siteId` equals the location's site (derived, though never sent — the input's `siteId` key is omitted entirely); the cross-site move test asserts the row's `siteId`/`siteLocationId`/`positionId` all changed together; duplicate tests assert `result.message` equals the Global Constraints string; delete-frees test re-inserts the same `employeeId` in the same location after `deleteWorker` and expects ok.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test app/dashboard/workers/actions.test.ts`
Expected: FAIL — module `./actions` does not exist.

- [ ] **Step 3: Implement `app/dashboard/workers/actions.ts`**

Structure mirrors `positions/actions.ts` + work-areas' derivation, in this order: `dbResult` (kind `worker-employee-id`), `fkResult` (FK_MESSAGE per Global Constraints), `effectiveSiteLocationId` (admin → `actor.siteLocationId ?? undefined`, else input), `deriveSiteId(siteLocationId)` (live-only lookup, returns `string | null`), `loadAndCheckPosition(positionId, siteId)` returning `{ ok: true }` or `{ fieldError: "Position must be in the same site as the location" }` — live-only, same-site, tolerant of `isActive: false`.

`createWorker`: requireUser → parse `workerCreateSchema` (pass `siteLocationId: effectiveSiteLocationId(...)`, never a client `siteId`) → admin's dead binding fails closed (`"Location not found."` field error) → derive siteId (`"Location is required"` field error when null) → ho location-scope check (`"Location must be in your site"`) → position check → insert `{ siteLocationId, siteId, employeeId, name, positionId, contractEndDate: parsed.data.contractEndDate ?? null }` → catch `fkResult` → `revalidatePath("/dashboard/workers")`.

`updateWorker`: uuid guard ("Invalid worker id.") → `workerOwnedByActor` ("Worker not found.") → parse `workerUpdateSchema` → same derive/scope/position checks on the NEW location (admin pinned: a move is impossible; the override re-pins to their binding) → `db.update(worker).set({ siteLocationId, siteId, positionId, employeeId, name, contractEndDate ?? null, isActive }).where(workerMutationWhere(actor, id))` → 0 rows → "Worker not found." → same catch pair → revalidate.

`toggleWorker` / `deleteWorker` / `setActiveBulk` / `deleteBulk`: mirror the position actions line-for-line (`sql\`not ${worker.isActive}\`` toggle; soft delete; bulk weld `workerBulkMutationWhere`; `deleteBulk` returns `blocked: 0` with a comment saying workers have no children).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test app/dashboard/workers/actions.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/workers/actions.ts app/dashboard/workers/actions.test.ts
git commit -m "feat(workers): worker CRUD server actions with move semantics"
```

---

### Task 3: Position bound-guard upgrade

**Files:**
- Modify: `app/dashboard/positions/actions.ts` (`deletePosition`, `deleteBulk`, stale comments)
- Create: `app/dashboard/positions/bound-guard.test.ts` (pattern: `positions/bulk.test.ts`)

**Interfaces:**
- Consumes: `worker` from `@/drizzle/schema` (shipped by #83); existing `positionMutationWhere` / `positionBulkMutationWhere`.
- Produces: `deletePosition(id)` now refuses while live workers reference the position; `deleteBulk(ids)` now returns real `applied`/`blocked` counts. No signature changes — Task 2-style callers and the bulk toolbar keep working.

- [ ] **Step 1: Write the failing test `app/dashboard/positions/bound-guard.test.ts`**

Fixtures `t12-wbg-`: site A + location + position PA + one live worker referencing PA. Tests (names verbatim):

```ts
describe("position bound-guard", () => {
  test("deletePosition with a live worker: blocked with the worker message");
  test("deletePosition after the worker soft-deletes: succeeds");
  test("deleteBulk splits applied and blocked across referenced positions");
  test("superadmin deletes a worker-free position: ok");
});
```

The blocked test asserts `result.ok === false`, `result.message` equals the Global Constraints guard string, and the position row still has `deletedAt: null`. The bulk test seeds two positions (one referenced, one free) and asserts `applied === 1`, `blocked === 1` with only the free row soft-deleted.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test app/dashboard/positions/bound-guard.test.ts`
Expected: FAIL — `deletePosition` soft-deletes unconditionally (ok:true), `deleteBulk` reports `blocked: 0`.

- [ ] **Step 3: Implement the guard in `app/dashboard/positions/actions.ts`**

`deletePosition`: after the ownership check, `const [{ count: liveWorkers }] = await db.select({ count: count() }).from(worker).where(and(eq(worker.positionId, id), isNull(worker.deletedAt)))`; if > 0 return `{ ok: false, message: "Some workers still reference this position" }`. `deleteBulk`: one grouped count `db.select({ positionId: worker.positionId, live: count() }).from(worker).where(and(inArray(worker.positionId, validIds), isNull(worker.deletedAt))).groupBy(worker.positionId)`; soft-delete only positions absent from that result; `blocked` = number of referenced ids; `applied` = updated rowCount. Remove the now-stale comments ("the workers bound-guard lands with the worker table", "the worker table does not exist", "blocked is always 0"). Import `worker` and `count`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test app/dashboard/positions/bound-guard.test.ts && bun test app/dashboard/positions/`
Expected: PASS — the new suite and the existing positions suites stay green.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/positions/actions.ts app/dashboard/positions/bound-guard.test.ts
git commit -m "feat(positions): block position deletes while live workers reference them"
```

---

### Task 4: Worker form component

**Files:**
- Create: `components/workers/worker-form.tsx`
- Create: `components/workers/worker-form.test.tsx` (pattern: `work-area-form.test.tsx`)

**Interfaces:**
- Consumes: Task 2's action names; `SiteOption`, `SiteLocationOption`, `PositionRow`, `WorkerRow` from `@/types/forms`; the `work-area-form.tsx` local helpers' shapes (`SelectOption`, `showFailure`, `toSelectItems`, `SelectField`).
- Produces: `WorkerForm` (props `{ sites, siteLocations, positions: PositionRow[], pinnedLocationName?, worker?: WorkerRow, onSaved }`), `CreateWorkerButton` (same options props), `WorkerRowActions` (same options props + `worker: WorkerRow`), `positionOptionsFor(positions, siteId: string | null): PositionRow[]` (filter helper, mirror `siteLocationOptionsFor`). Task 5 imports `WorkerRowActions`; Task 6 imports `CreateWorkerButton`.

- [ ] **Step 1: Write the failing test `components/workers/worker-form.test.tsx`**

`renderToStaticMarkup` pattern, no DB. Fixtures: sites A/B; locations LA1/LA2 (site A), LB (site B); positions PA1/PA2 (site A, one inactive), PB (site B). Tests (names verbatim):

```ts
describe("positionOptionsFor", () => {
  test("no site picked keeps only positions of every site");
  test("a picked site keeps only its own positions");
});
describe("WorkerForm cascade", () => {
  test("create with multiple sites: Site field renders and location is locked until a site is picked");
  test("create with a single site: no Site select, location unlocked");
  test("edit: the site select is pre-set to the worker's site and employee id prefilled");
  test("admin pinned location renders disabled with the pinned name");
});
```

Inactive positions appear in the options props but the rendered picker for a picked site must not offer them — the static markup for site A's picker contains PA1's active name and not the inactive one's (the page pre-filters; the form filters `isActive` defensively in `positionOptionsFor`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test components/workers/worker-form.test.tsx`
Expected: FAIL — module `./worker-form` does not exist.

- [ ] **Step 3: Implement `components/workers/worker-form.tsx`**

Copy `work-area-form.tsx` as the base. Cascade: site select (shown when `pinnedLocationName === undefined && sites.length > 1`) filters both `siteLocationOptionsFor(siteLocations, siteId)` and `positionOptionsFor(positions, siteId)`; a site switch resets `siteLocationId` AND `positionId` (the old picks may belong to the old site). Fields in order: Site (conditional), Location (`LocationSelect` with admin pin), Position (plain `SelectField`, placeholder "Select a position", locked with "Select a location first" until a location's site resolves — position options derive from the picked site, or the worker's `siteId` on edit), Employee ID (`Input`, `maxLength={100}`, required), Name (`Input`, `maxLength={200}`, required), Contract end (`Input type="date"`, optional). Submit: create → `createWorker({ siteLocationId, positionId, employeeId, name, contractEndDate: contractEndDate || undefined })`; edit → `updateWorker(worker.id, { …same, isActive: worker.isActive })`; contractEndDate omitted when empty string. `WorkerRowActions` mirrors `WorkAreaRowActions` (toggle/edit/delete controlled dialogs; delete confirm text: "“{name}” will be hidden from the list." — no bound-guard caveat, workers have no children).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test components/workers/worker-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/workers/worker-form.tsx components/workers/worker-form.test.tsx
git commit -m "feat(workers): worker form dialog with site-location-position cascade"
```

---

### Task 5: Workers table component

**Files:**
- Create: `components/workers/workers-table.tsx` (pattern: `positions-table.tsx`)

**Interfaces:**
- Consumes: Task 2's `setActiveBulk` / `deleteBulk`; Task 4's `WorkerRowActions`; `DataTable`, `BulkToolbar`, `SiteFilter`, `StatusFilter`, `StatusBadge`, `dataTableFeatures`; `WorkerRow`, `SiteOption`, `SiteLocationOption`, `PositionRow`.
- Produces: `WorkersTable` (props `{ workers: WorkerRow[]; showSiteFilter: boolean; sites: SiteOption[]; siteLocations: SiteLocationOption[]; positions: PositionRow[]; pinnedLocationName?: string; pageCount: number; total: number }`). Task 6 renders it with exactly these props.

- [ ] **Step 1: Write the failing test `components/workers/workers-table.test.tsx`**

Static-markup render with a minimal `WorkerRow[]` fixture: the markup contains the employee id, both joined names, and the "No workers yet." empty message renders when the data array is empty. (The bulk toolbar and filters are covered by the shared components' own suites and the Task 6 page test.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test components/workers/workers-table.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `components/workers/workers-table.tsx`**

Copy `positions-table.tsx`. `createColumnHelper<typeof dataTableFeatures, WorkerRow>()`. Columns: `employeeId` ("Employee ID", sortable, `font-medium`), `name` ("Name", sortable), `locationName` ("Location"), `siteName` ("Site", sortable), `positionName` ("Position"), `contractEndDate` ("Contract end", sortable — render `–` when null), `isActive` ("Status", sortable, `StatusBadge`), actions display column → `WorkerRowActions` (thread `sites`, `siteLocations`, `positions`, `pinnedLocationName`). `useMemo` deps `[sites, siteLocations, positions, pinnedLocationName]`. `DataTable` with `pageCount`, `total`, `emptyMessage="No workers yet."`, `getRowId={(row) => row.id}`, `filters` (SiteFilter when `showSiteFilter`, StatusFilter), `selectionToolbar` → `BulkToolbar entityName="worker"` wired to the two bulk actions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test components/workers/workers-table.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/workers/workers-table.tsx components/workers/workers-table.test.tsx
git commit -m "feat(workers): workers table with bulk toolbar and filters"
```

---

### Task 6: Workers page + full verification

**Files:**
- Modify: `app/dashboard/workers/page.tsx` (replace the stub wholesale)
- Create: `app/dashboard/workers/page.test.ts` (pattern: `positions/page.test.ts`)

**Interfaces:**
- Consumes: Task 4's `CreateWorkerButton`, Task 5's `WorkersTable`; `worker, site, siteLocation, position` from `@/drizzle/schema`; `parseTableSearchParams`, `PAGE_SIZE_OPTIONS`, `ilikePattern`; `buildOrder`; `requireUser`.
- Produces: the working route. `SORTABLE = { employeeId: worker.employeeId, name: worker.name, siteName: site.name, contractEndDate: worker.contractEndDate, isActive: worker.isActive }`; `DEFAULT_ORDER = [asc(site.name), asc(worker.employeeId)]`.

- [ ] **Step 1: Write the failing test `app/dashboard/workers/page.test.ts`**

Mirror `positions/page.test.ts` exactly (session mock, RSC tree collector — props key `"workers"`, `t13-wpage-` fixtures: sites A/B, locations LA1 on A + LB on B, positions PA (A) + PB (B), workers W1 (LA1) + W2 (LB)). Tests (names verbatim):

```ts
describe("workers page server queries", () => {
  test("admin sees only workers in their binding location");
  test("ho sees all workers under their site, not other sites'");
  test("superadmin siteId filter keeps only that site's workers; junk shows all");
  test("dialog receives the role-scoped site, location, and position options");
  test("unbound admin sees nothing");
});
```

The dialog-options test asserts, for a ho, `sites` = `[siteA]`, every returned `siteLocations`/`positions` option has `siteId === siteA`, and the positions options exclude the inactive one (page pre-filters to live+active).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test app/dashboard/workers/page.test.ts`
Expected: FAIL — the stub renders no `workers` prop node (collector finds 0).

- [ ] **Step 3: Implement the page**

Copy `positions/page.tsx` with these deltas: `instant = false` + its verbatim comment; the count query joins `site` (where/order need it); the fetch query joins `site`, `siteLocation`, `position` and selects `WorkerRow`'s fields (`locationName: siteLocation.name`, `positionName: position.name`); scope per Global Constraints (admin welds `worker.siteLocationId` to the binding, not the site); search composes `or(ilike(worker.name, pattern), ilike(worker.employeeId, pattern))`; `siteFilter` superadmin-only on `worker.siteId`; fixture fetch in `Promise.all` with the rows query: role-scoped `sites` (positions-page pattern), role-scoped `siteLocations` (superadmin: all live with `siteId`; ho: their site's; admin: only the binding row), `positions` (live+active, role-scoped by the same site branches). Header copy: "Workers" / "Worker master data per site_location, scoped per role. Every role manages workers within its own scope." Both `CreateWorkerButton` and `WorkersTable` receive the same fixture props (`sites`, `siteLocations`, `positions`, `pinnedLocationName`). Thread `pinnedLocationName={actor.role === "admin" ? sites[0] && siteLocations[0]?.name : undefined}` — for an admin the page shrinks `siteLocations` to their binding, so `siteLocations[0]?.name` is the pinned name (undefined when unbound).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test app/dashboard/workers/page.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full verification**

Run: `bun test && bun run lint && bun run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/workers/page.tsx app/dashboard/workers/page.test.ts
git commit -m "feat(workers): workers dashboard page replaces the stub"
```
