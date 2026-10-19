# Worker Multi-Position — Design Spec

| | |
|---|---|
| Date | 2026-10-20 |
| Status | Design approved in chat; awaiting spec review |
| Scope | `worker` ↔ `position` becomes many-to-many; worker CRUD, position bound-guard, page/table/form |
| Related | `docs/specs/2026-10-20-worker-crud-design.md` (the CRUD this evolves), `docs/architecture.md` §4, §5.2 (C8), §6 |

## 1. Context

Today a worker holds exactly one position: `worker.position_id NOT NULL`, welded to the worker's site by the composite FK `worker_position_site_fk (position_id, site_id) → position (id, site_id)`.

The product now needs one worker to hold **many positions** (multi-skill staff), so the roster engine can later consider a worker qualified for more than one kind of work. Rule **C8** ("Work qualification match") is the eventual consumer; it stays **dormant** — this spec ships data + CRUD only, no engine change.

The many-to-many shape is a deliberate domain change: positions become a **set** with no primary. Existing `worker.position_id` is migrated into that set and then removed.

## 2. Decisions (agreed in chat, 2026-10-20)

1. **Pure set, no primary position.** `worker.position_id` is dropped; every position is equal.
2. **Minimum one position per worker.** Enforced in Zod (`.min(1)`) and in the form; a worker with zero positions is invalid.
3. **Pivot table with denormalized `site_id` and two composite FKs** (approach A). Same-site pairing stays a DB-level guarantee, consistent with the existing worker/location/position FKs and the "site-scoping at the data level" pillar. An array column and app-only validation were rejected.
4. **Inactive positions are preserved.** Positions are per-site and soft-deleted on guard. The picker offers active positions for *new* picks; a position already attached to the worker stays visible (and removable) even after deactivation, so an unrelated edit never silently drops it.
5. **No UI for reordering positions.** The set has no order; display is alphabetical by name.
6. **No roster-engine, assignment, or C8 behavior change.** Out of scope (§10).

## 3. Data model

### 3.1 New table `worker_position`

One row per worker↔position pair.

| Column | Type | Notes |
|---|---|---|
| `worker_id` | `uuid NOT NULL` | part of PK |
| `position_id` | `uuid NOT NULL` | part of PK |
| `site_id` | `uuid NOT NULL` | denormalized weld; must match both parents |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | stable insertion time |

Constraints:

- PK `(worker_id, position_id)` — duplicates impossible.
- Index `worker_position_position_id_idx` on `position_id` — the delete-guard and bulk guard group by it.
- FK `worker_position_worker_site_fk`: `(worker_id, site_id) → worker (id, site_id)`, `ON DELETE RESTRICT`.
- FK `worker_position_position_site_fk`: `(position_id, site_id) → position (id, site_id)`, `ON DELETE RESTRICT`.
- New plain unique constraint on `worker` : `unique(worker.id, worker.site_id)` named `worker_id_site_id_unique` — required for the composite FK to resolve (same pattern as `position_id_site_id_unique`).

Cross-site pairing is therefore rejected by PostgreSQL (23503) even by direct insert or under a race, exactly like the existing `worker_position_site_fk`.

### 3.2 Ordering constraint on worker updates

The composite FK references `worker (id, site_id)`. Changing `worker.site_id` while old pivot rows still carry the previous site would violate the FK. Therefore **update order inside the transaction is fixed**:

1. delete the worker's pivot rows,
2. update the worker row (including `site_id`, welded ownership predicate),
3. insert the new pivot set with the new `site_id`.

If step 2 matches zero rows, the transaction rolls back (sentinel return), so positions are never lost by a lost race.

### 3.3 Drizzle relations

`drizzle/schema/worker-schema.ts` gains `workerPosition`, `workerPositionRelations` (`one(worker)`, `one(position)`), and `workerRelations.positions: many(workerPosition)`. Relations stay in `worker-schema.ts` to keep the one-way dependency (`worker-schema → site-schema, position-schema`) and avoid evaluation cycles. The barrel `drizzle/schema/index.ts` already re-exports this file.

### 3.4 Migrations (expand → contract)

Two generated-and-hand-ordered migrations, so every implementation step keeps a buildable tree:

**`0015` (expand)** — additive only; `worker.position_id` is **kept**:

1. `ALTER TABLE "worker" ADD CONSTRAINT "worker_id_site_id_unique" UNIQUE("id","site_id");` — must precede the pivot's `CREATE TABLE`, because the composite FK resolves against it.
2. `CREATE TABLE "worker_position" (...)` with both composite FKs inline.
3. `CREATE INDEX "worker_position_position_id_idx" ...`.
4. Backfill:

   ```sql
   INSERT INTO "worker_position" ("worker_id", "position_id", "site_id")
     SELECT "id", "position_id", "site_id" FROM "worker";
   ```

**`0016` (contract)** — only after every read and write uses the pivot:

```sql
ALTER TABLE "worker" DROP CONSTRAINT "worker_position_site_fk";
ALTER TABLE "worker" DROP COLUMN "position_id";
```

Rules:

- The backfill includes soft-deleted workers: pivot rows are history, and guards join live workers.
- Between 0015 and 0016, `createWorker`/`updateWorker` **dual-write** `worker.position_id = positionIds[0]` purely to satisfy the still-`NOT NULL` column. The first id carries no primary semantics; 0016 removes the dual-write.
- Verify the backfill with:

  ```sql
  SELECT count(*) FROM "worker" w
  LEFT JOIN "worker_position" wp ON wp.worker_id = w.id
  WHERE wp.worker_id IS NULL;
  ```

  Expected `0`.
- `meta/_journal.json` is updated by the generator; migration files and the journal are committed (they ship in the prod image). DDL is transactional in PostgreSQL, so a failed migration leaves the schema unchanged.

## 4. Validation and server actions

### 4.1 Validators (`schema/validators.ts`)

- `workerCreateSchema`: `positionId: z.uuid()` → `positionIds: z.array(z.uuid()).min(1)` with a uniqueness refine:

  ```ts
  z.array(z.uuid()).min(1).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "Select each position once" },
  )
  ```

  Array-level issues land on the field key `positionIds` via `fieldErrorsFrom` (path join).
- `workerUpdateSchema` inherits the change through `extend`.
- No maximum count (YAGNI); malformed/duplicate ids are rejected, not silently repaired, at the validator boundary. The form de-duplicates before submit.

### 4.2 Position check (`app/dashboard/workers/actions.ts`)

Replace `loadAndCheckPosition` with:

```ts
async function loadAndCheckPositions(ids: string[], siteId: string)
```

- One `SELECT id, site_id FROM position WHERE id IN (...) AND deleted_at IS NULL`.
- Failure if any requested id is missing/soft-deleted, or any returned `site_id !== siteId`.
- Returns the shared field error `"Position must be in the same site as the location"`.
- **Inactive positions are accepted** (unchanged behavior): an edit that does not touch positions must not fail because one was deactivated after the picker snapshot. The form only *offers* active ones for new picks.

### 4.3 `createWorker`

Input changes to `positionIds: string[]`. After the existing location derive/scope checks and the position-set check:

```ts
await db.transaction(async (tx) => {
  const [row] = await tx.insert(worker).values({ ... }).returning({ id: worker.id });
  await tx.insert(workerPosition).values(
    positionIds.map((positionId) => ({ workerId: row.id, positionId, siteId: derivedSiteId })),
  );
});
```

The worker insert and all pivot rows commit or roll back together. `fkResult` still maps 23503/23001 to "Selected location or position no longer exists". Until migration `0016`, the insert also writes the temporary `positionId: positionIds[0]` placeholder (§3.4).

### 4.4 `updateWorker`

Same input rename. Inside `db.transaction`:

1. `DELETE FROM worker_position WHERE worker_id = id` (tx).
2. `UPDATE worker ... WHERE workerMutationWhere(actor, id) RETURNING id`.
3. If zero rows: return a `{ notFound: true }` sentinel from the transaction callback; the action returns `"Worker not found."` and the delete is rolled back.
4. `INSERT` the new pivot set with `derivedSiteId`.

Ownership pre-check (`workerOwnedByActor`) stays before the transaction; the welded `WHERE` inside it is the authoritative gate. Cross-site moves (superadmin only) replace the whole pivot set with positions of the new site — allowed only if every position belongs to that site. Until migration `0016`, step 2 also writes the temporary `positionId: positionIds[0]` placeholder (§3.4).

### 4.5 Unchanged actions

`toggleWorker`, `setActiveBulk`, `deleteBulk` only touch `worker` columns. `deleteWorker` soft-deletes the worker and **leaves pivot rows in place** (visibility flag semantics); guards join live workers, so stale rows never block a position delete. Stale comments claiming "workers have no children" are corrected.

## 5. Position bound-guard (`app/dashboard/positions/actions.ts`)

Both guards move from `worker.position_id` to the pivot:

- `deletePosition`: count live workers referencing the position:

  ```sql
  SELECT count(*) FROM worker_position wp
  JOIN worker w ON w.id = wp.worker_id
  WHERE wp.position_id = $1 AND w.deleted_at IS NULL
  ```

  Message unchanged: `"Some workers still reference this position"`.
- `deleteBulk`: same join, grouped by `wp.position_id` over the in-scope batch; `blocked` = positions with at least one live worker, `applied` = the rest. Out-of-scope ids are still dropped before counting (no counters leak foreign sites).

## 6. Page and table

### 6.1 `app/dashboard/workers/page.tsx`

- Main worker query: remove `innerJoin(position, ...)` (a join through the pivot would duplicate worker rows). Keep worker/site/location joins, filters, sort whitelist, pagination.
- After the page query, fetch the positions for exactly those worker ids:

  ```ts
  db.select({ workerId: workerPosition.workerId, id: position.id, name: position.name, isActive: position.isActive })
    .from(workerPosition)
    .innerJoin(position, eq(workerPosition.positionId, position.id))
    .where(inArray(workerPosition.workerId, ids))
    .orderBy(asc(position.name))
  ```

  Group into a `Map<workerId, PositionSummary[]>` and attach to each row. Skip the query when the page is empty.
- The options query for the form **drops `eq(position.isActive, true)`** (keeps `deleted_at IS NULL` and the existing role/site scope) so an attached inactive position can be rendered and removed.
- `WorkerRow` (all UI paths) carries `positions: { id: string; name: string; isActive: boolean }[]`; `positionId`/`positionName` are removed. A worker with no pivot rows (defensive; should not exist) renders `–`.

### 6.2 `components/workers/workers-table.tsx`

- Position column: names joined with `", "`, `–` when empty. Not sortable (unchanged; `positionName` was never in `SORTABLE`).
- No other column changes.

## 7. Worker form UI

`components/workers/worker-form.tsx`:

- State: `positionIds: string[]` (prefilled from `worker.positions.map(p => p.id)`).
- Replace the single `SelectField` with a **checkbox group** inside a scrollable bounded box (`components/ui/checkbox.tsx` exists), labelled "Positions":
  - *Candidates* for new picks come from `positionOptionsFor(positions, positionSiteId)` (active, live, same site — unchanged helper).
  - *Rendered* options = candidates ∪ every position whose id is currently in `positionIds` (resolved against the full `positions` prop, which the page now provides without the `isActive` filter). So an attached inactive position stays visible and removable; it is never offered for a new pick. Selected inactive options get a `" (inactive)"` suffix.
  - Checkbox `id` includes the position id; `checked` reflects the state; clicking toggles membership.
  - `aria-invalid` + `FieldError` keyed on `fieldErrors.positionIds`.
- Site pick change: clear `positionIds` along with the location (existing behavior extended to the set).
- Location change: if the new location resolves to a **different site**, clear `positionIds`; a same-site location change keeps them.
- Pre-submit guard: `positionIds.length === 0` → `"Position is required"`, no server call.
- Payload: `positionIds` (array) replacing `positionId`; absent optional fields keep the existing `undefined` convention.
- Dialog copy: "A worker sits at a location and holds one or more positions…" (create) / "Update the worker's location, positions, or details." (edit).

## 8. Testing

TDD: each row below lands as a failing test before the corresponding change.

| Suite | Cases |
|---|---|
| `lib/worker-fk.test.ts` | pivot rejects a position from another site (23503); rejects a `site_id` that does not match the worker's site (23503); PK rejects a duplicate pair; existing worker FK tests updated to insert pivot rows instead of `position_id` |
| `app/dashboard/workers/actions.test.ts` | create with 2+ positions persists both; `[]` rejected with `fieldErrors.positionIds`; duplicate ids rejected; foreign-site id rejected; update replaces the set (removed id gone, added id present); cross-site move by superadmin rewrites pivot `site_id`; ho cross-site move still rejected; update on a foreign/vanished worker leaves pivot untouched; inactive position accepted |
| `app/dashboard/workers/page.test.ts` | each row carries all its positions in name order; role scoping unchanged; a worker with no pivot rows still renders (`–`); position options include inactive positions |
| `components/workers/worker-form.test.tsx` | multiple checkboxes render with correct `checked` state on edit; an attached inactive position renders with `(inactive)` while other inactive positions stay hidden; empty set renders the field error; `positionOptionsFor` still filters candidates to the site |
| `app/dashboard/positions/bound-guard.test.ts` | single delete blocked by any live worker holding the position; allowed after the worker is soft-deleted; bulk `applied/blocked` split across a multi-position worker |
| `app/dashboard/positions/*.test.ts` | fixtures updated from `positionId` to pivot inserts |

Verification floor: `bun run lint`, `bun test` (DB-backed suites need the compose Postgres), `bun run build`.

## 9. Docs

- `docs/architecture.md`: add a revision note that a worker now holds a **set** of positions via `worker_position` (qualifications), and that C8 remains dormant pending assignment-side requirements. Update the "Implemented so far" paragraph to include `worker` / `position` / `worker_position`.
- This spec and its plan live in tracked paths (`docs/specs/`, `docs/plans/`). No references to globally-ignored docs.

## 10. Out of scope

- Roster engine changes, assignment-time position selection, activating C8.
- Work-area qualification requirements.
- CSV/Excel import, NIK/employment status, per-position rates.
- Ordering or a "primary" flag on positions.
- Hard-deleting workers or pivot rows.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Prod entrypoint auto-migrates; the drop runs before data is copied | Expand/contract: `0015` creates + backfills while the column survives; `0016` drops only after every read/write uses the pivot; backfill count verified |
| Composite FK blocks `worker.site_id` updates | Fixed delete → update → insert order inside one transaction; zero-row update rolls back |
| Inactive attached positions silently dropped on edit | Options include attached inactive rows; explicit `(inactive)` rendering; action still accepts them |
| Broad fixture churn (tests insert `positionId`) | Mechanical update to pivot inserts in the same change; FK suite proves the new integrity |
| Read path duplicates workers | Main query never joins the pivot; one grouped follow-up query per page |

## 12. Definition of done

- A worker can be created, edited, moved, and deleted with 0..n positions (minimum 1 on create/edit) across all three roles, with scope unchanged.
- DB rejects cross-site pairs and duplicate pairs.
- Position delete (single + bulk) is blocked by any live worker holding it.
- `bun run lint`, `bun test`, `bun run build` pass.
