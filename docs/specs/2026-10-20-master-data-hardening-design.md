# Master-Data Hardening — Design Spec (follow-ups from #85 review)

| | |
|---|---|
| Date | 2026-10-20 |
| Status | Design from review findings on #85/#86; awaiting implementation |
| Scope | Three small hardening fixes surfaced by the #85 review chain |
| Related | `docs/specs/2026-10-20-worker-crud-design.md` (the review that surfaced these), `docs/plans/2026-10-20-worker-crud-plan.md` |

## 1. Context

The #85 whole-branch review approved the worker CRUD with zero Critical/Important findings, but laid out three follow-up-safe items: an in-scope-vs-leak on the positions bulk `blocked` counter, an inconsistent not-found answer on `deleteWorker`, and dead-data positions in the superadmin picker. None affects the UI-reachable paths of the shipped pages; each is a small weld-consistency or display fix worth one focused ticket rather than a reopening of #85.

## 2. Decisions

1. **Positions `deleteBulk` never reports out-of-scope ids in `blocked`.** A scoped non-owner must not learn whether foreign positions hold live workers (a 1-bit oracle today). The batch is first intersected with the actor's write scope (`positionBulkMutationWhere`); out-of-scope ids are dropped silently from the reported counts — they already could not have been written, so this matches the "do what you can" semantics of the shipped bulk actions. `applied` behavior is unchanged.
2. **`deleteWorker` gains the same 0-rows net as `updateWorker`/`toggleWorker`.** The soft delete reports `"Worker not found."` when its welded write touches 0 rows (missing or already-deleted id). Idempotence in the double-click case is unaffected: a live owned row is still `ok: true`.
3. **Positions picker queries exclude positions under a soft-deleted site** via `isNull(site.deletedAt)` on the join: the `workers` page and the `positions` page fixture queries. The `deleteSiteGuarded` flow is NOT changed here — guarding live positions during site delete is a product decision with its own consequences (sites holding only live positions could never be deleted) and stays out of scope.

## 3. Files

| File | Change |
|---|---|
| `app/dashboard/positions/actions.ts` | `deleteBulk`: scope-intersect + `applied`/`blocked` reporting |
| `app/dashboard/positions/bound-guard.test.ts` | extend: mixed-scope batch test |
| `app/dashboard/workers/actions.ts` | `deleteWorker`: `.returning({ id })` + 0-rows net |
| `app/dashboard/workers/actions.test.ts` | extend: missing-id delete test |
| `app/dashboard/workers/page.tsx` | positions fixture query: `isNull(site.deletedAt)` |
| `app/dashboard/positions/page.tsx` | positions fixture query: `isNull(site.deletedAt)` |
| `app/dashboard/workers/page.test.ts` | extend: soft-deleted-site position excluded |
| `app/dashboard/positions/page.test.ts` | extend: soft-deleted-site position excluded |

No schema, migration, copy-string, or component changes. All copy used already exists verbatim in the codebase (`"Worker not found."`); the batch-no-leak change adds no message.

## 4. Scoping and failure modes

- The deleteBulk intersect reuses `positionBulkMutationWhere` — the same predicate the shipped write uses. No new scope rules are invented; a distinguishing test pins that a ho's mixed batch returns `blocked` counting only their site's referenced position and the foreign referenced position appears in neither `blocked` nor `applied` while both rows stay live.
- The deleteWorker net rides the existing weld (`workerMutationWhere`), so the 0-rows answer cannot widen scope — a foreign missing id already answers "not found." at the ownership check; the net only covers the ownership-check-to-write window.
- The picker guard is fail-closed for the superadmin branch only touched state (ho/admin branches are already site-pinned by their own predicates); an excluded position is one the sites list can never offer and no live location can accept, so no writable path depends on it.

## 5. Testing

Extend the existing suites (shared dev-DB fixture prefixes honored):

- `bound-guard.test.ts` (fixtures `t12-wbg-`): `deleteBulk on a mixed batch: out-of-scope referenced ids are neither blocked nor applied`.
- `workers/actions.test.ts` (`t11-wact-`): `deleteWorker on a missing worker: not found`.
- `workers/page.test.ts` (`t13-wpage-`): `pickers exclude positions under a soft-deleted site`.
- `positions/page.test.ts`: same-style test for the positions page.
- `bun test`, `bun run lint`, `bun run build` all green.

## 6. Out of scope

- The soft-delete race window (soft-deleted parent between live-check and write) — #85 controller ruling: codebase-wide epic across master-data pages.
- Stale-`isActive` edit payload (lost concurrent toggle) — similarly epic-level, shared form shape across master data.
- Live-positions guard in `deleteSiteGuarded` (product decision).
- Spec §11 worker-CRUD follow-ups (CSV import, NIK/PKWT columns, contract-end alerts).
