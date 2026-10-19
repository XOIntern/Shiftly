# Worker CRUD — Design Spec

| | |
|---|---|
| Date | 2026-10-20 |
| Status | Design approved in chat; awaiting implementation |
| Scope | `/dashboard/workers` CRUD (full parity), position bound-guard upgrade |
| Related | `docs/specs/2026-10-20-worker-table-design.md` (the table this builds on), `docs/architecture.md` §4 (Master Data), §5 (site-scoping), §6 (Data Model) |

## 1. Context

Ticket #83 shipped the `worker` table, its migration, and FK pin tests. `/dashboard/workers` is still the placeholder stub. This spec covers the CRUD page that replaces it — the unit of master data every roster depends on — plus the position bound-guard upgrade that the worker-table spec deferred to this ticket (`app/dashboard/positions/actions.ts`: "the workers bound-guard lands with the worker table").

The page mirrors the established master-data pattern (sites → locations → positions → work-areas): server component with URL-driven search/sort/pagination, dialog forms, row actions, bulk toolbar, per-role data-level scoping.

## 2. Decisions (agreed in chat, 2026-10-20)

1. **Full parity** with the other master-data pages: search, sort, pagination, status/site filters, create/edit dialogs, activate/deactivate toggle, soft delete, bulk set-active, bulk delete.
2. **All fields are editable after create** — name, `employee_id`, `contract_end_date`, `is_active`, and the worker may be **moved to another location or position**. `site_id` is never an input: it always follows the chosen location's site (a "site move" is a location pick from another site). Scoping still bounds every role (§4) — editability never widens scope.
3. **Admins are location-scoped** (worker spec §2: each admin manages their own location's workers): an admin's location is pinned to their binding; ho actors are site-scoped; superadmin is unscoped and is the only role that can effectively move a worker across sites.
4. **Server-side consistency**: `site_id` is derived from the live `site_location` (never trusted from the client, mirroring `deriveSiteId` in work-areas actions); the position is verified live and same-site. The #83 composite FKs (`worker_site_location_site_fk`, `worker_position_site_fk`) remain the DB-level backstop — cross-site pairing is impossible even under a race (23503).

## 3. Architecture and files

| File | Change |
|---|---|
| `lib/worker-scope.ts` | new — `workerOwnedByActor`, `workerMutationWhere`, `workerBulkMutationWhere` (same shapes as `position-scope.ts` / `work-area-scope.ts`) |
| `app/dashboard/workers/actions.ts` | new — `createWorker`, `updateWorker`, `toggleWorker`, `deleteWorker`, `setActiveBulk`, `deleteBulk` |
| `app/dashboard/workers/page.tsx` | replaces the stub — server component, `instant = false`, `parseTableSearchParams`, count-first + clamp page, scope weld, `Promise.all` fixture fetch |
| `components/workers/worker-form.tsx` | new — `WorkerForm`, `CreateWorkerButton`, `WorkerRowActions` (mirror `work-area-form.tsx` incl. controlled confirm dialogs) |
| `components/workers/workers-table.tsx` | new — table + bulk toolbar (mirror `positions-table.tsx`) |
| `schema/validators.ts` | add `workerCreateSchema`, `workerUpdateSchema` |
| `types/forms.ts` | add `WorkerRow` (reuse `SiteOption`, `SiteLocationOption`) |
| `types/db-error.ts` | add `DbErrorKind` `"worker-employee-id"` + `DUPLICATE_MESSAGES` entry |
| `app/dashboard/positions/actions.ts` | bound-guard upgrade (§9) |

No schema or migration changes — the #83 table is consumed as-is. Navigation already links `/dashboard/workers`.

## 4. Scoping per role (fail-closed)

Worker rows are location-scoped, so the admin branch welds on `site_location_id` directly (not the binding's site):

- **superadmin** — unscoped.
- **ho** — `worker.site_id = actor.siteId`; unbound ho → `sql`false``.
- **admin** — `worker.site_location_id = actor.siteLocationId`; unbound admin → `sql`false`` (a dead binding resolves to NULL and can never match — same scalar-subquery shape as `positionMutationWhere`).

The page's fixture queries (sites, locations, positions for pickers) are role-scoped exactly like the positions page: superadmin all sites, ho their one site, admin their binding's site (locations shrink to the binding for the pinned pick).

## 5. Create flow

Inputs: `siteLocationId`, `positionId`, `employeeId`, `name`, `contractEndDate?`. No `siteId` is sent.

1. Admin: the location pick is overridden server-side with their binding (`effectiveSiteLocationId` pattern).
2. `siteId` ← derived from the **live** location; a dead/missing pick fails closed at the field.
3. Scope check on the pick: ho may only reference a location under their own site ("Location must be in your site"), mirroring work-areas.
4. Position check: live (not soft-deleted) and `position.siteId = derived siteId` — else field error "Position must be in the same site as the location". Inactive positions are accepted server-side (see §6).
5. Insert; catch: 23505 → `mapDbError` kind `worker-employee-id` ("Employee ID already in use in this location"); 23503/23001 → "Selected location or position no longer exists" (FK net for races).

## 6. Update flow (move semantics)

`updateWorker(id, { siteLocationId, positionId, employeeId, name, contractEndDate, isActive })`.

- Ownership first (`workerOwnedByActor`), then the weld rides inside the mutating WHERE (`workerMutationWhere`) — a foreign row answers "Worker not found."
- The new location must be **live** and within the actor's location-scope rules (§4): for an admin the pick is pinned to their binding (a move is impossible for them); for ho the pick must be in their site; for superadmin any live location of any site.
- The new `site_id` is re-derived from the new location — moving a worker across sites **is** this derivation, and only superadmin can drive it. The write also verifies the new position is live and same-site with the new location.
- Inactive positions are accepted server-side so an edit that does not touch the position never fails because the position was deactivated since; the picker only *offers* active positions (§7).

## 7. Table UI

- Columns: Employee ID, Name, Location (+ Site column for superadmin), Position, Contract end (plain date display), Status (active badge), row actions menu.
- Search `q`: name **and** `employee_id` (both own-column, mirroring the "name-only" note's rationale — joined site name is not searched).
- Filters: status (active/inactive); site filter superadmin-only (ho/admin are data-scoped already).
- Sort whitelist: `employeeId, name, siteName, contractEndDate, isActive`; default order `[site.name asc, employee_id asc]`.
- Bulk toolbar: set active + delete (soft delete; workers have no children, so worker bulk `blocked` is always 0 — shape kept for the shared toolbar).
- Row actions: Activate/Deactivate (confirm dialog), Edit, Delete (confirm dialog; soft).
- Position picker lists only **active, live** positions of the picked site (server tolerance per §5/§6).

## 8. Error handling

- `mapDbError` gains `worker-employee-id` (23505 message above). `REFERENCE_CODES` already covers 23503/23001.
- FK net message: "Selected location or position no longer exists" — both composite FKs fire on vanished parents between pick and write.
- Scope violations are per-field errors ("Location must be in your site", "Position must be in the same site as the location"); foreign rows answer "Worker not found." (no scope leak).
- Validators: `employeeId` required text (trimmed, max 100), `name` required (max 200), `contractEndDate` optional `yyyy-mm-dd` string, uuid checks on all ids.

## 9. Position bound-guard upgrade

In `app/dashboard/positions/actions.ts`:

- `deletePosition`: refuse the soft delete while **live workers** reference the position (`select count` on `worker` where `position_id = id` and `deleted_at is null`) → message "Some workers still reference this position". A live worker referencing a position is necessarily in the position's own site (same-site FK), so no cross-scope count leak.
- `deleteBulk`: one grouped count over the batch; positions with live workers are skipped, `blocked` = their count, `applied` = the rest — the existing `applied/blocked` toolbar shape.
- Stale comments ("the worker table does not exist", "blocked is always 0") are removed.

## 10. Testing

Mirror the positions/work-areas suites:

- Page test (render/scope fixtures) and bulk actions test (DB-backed) — pattern of `positions/page.test.ts`, `positions/bulk.test.ts`.
- Worker actions tests (DB-backed): scoping per role (superadmin/ho/admin + unbound fail-closed), create derive-site + same-site position check, move within site ✓, cross-site move by superadmin ✓ and by ho rejected (weld + location scope), `employee_id` duplicate → 23505 mapping, freed after soft delete, toggle, delete.
- Position bound-guard tests: delete blocked with a live worker; allowed again after the worker is soft-deleted; bulk `applied/blocked` split.
- `bun test`, `bun run lint`, `bun run build` all green.

## 11. Out of scope (follow-ups, not reopened here)

- CSV/Excel worker import (lands on this page later).
- Work-area placement table (rule C7 join target).
- NIK, employment status (PKWT/PKWTT), join date, qualifications — the columns do not exist yet.
- `contract_end_date`-based alerts or expiry highlighting.
