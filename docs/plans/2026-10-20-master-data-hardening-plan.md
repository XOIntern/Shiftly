# Master-Data Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small hardening fixes from the #85 review: defend the positions bulk `blocked` count against out-of-scope probing, give `deleteWorker` the standard 0-rows net, and keep positions under soft-deleted sites out of the pickers.

**Architecture:** All three changes reuse shipped welds/predicates — no new scope rules. `deleteBulk` intersects its batch with `positionBulkMutationWhere` before reporting; `deleteWorker` adds `.returning({ id })` on its already-welded update; both picker queries add `isNull(site.deletedAt)` to the existing `site` join.

**Tech Stack:** Next.js App Router server actions, Drizzle ORM, PostgreSQL 18 (compose), zod, Bun test runner.

**Spec:** `docs/specs/2026-10-20-master-data-hardening-design.md`

## Global Constraints

- Bun only: `bun test`, `bun run lint`, `bun run build` — never npm/yarn/pnpm.
- DB-backed tests need the compose Postgres up: `docker compose up -d`.
- Exact copy, verbatim: `"Worker not found."` (already in the codebase; used after 0-rows). No new user-facing strings exist in this plan.
- `deleteBulk` never reports out-of-scope ids: they appear in neither `applied` nor `blocked` — dropped silently, matching the shipped "do what you can" bulk semantics.
- The scope intersect reuses `positionBulkMutationWhere` from `@/lib/position-scope`; the 0-rows net rides the existing `workerMutationWhere` weld. No new predicates, signatures, or exports.
- Fixture prefixes per suite (shared dev DB): extend the existing suites — `t12-wbg-` (bound-guard), `t11-wact-` (workers actions), `t13-wpage-` (workers page); the positions page extends its existing page-test fixtures.
- Never stage or commit globally-ignored files; verify unfamiliar paths with `git check-ignore -v <path>` before `git add`.

## Review Focus

1. A ho batch containing a foreign site's referenced position must not report it as `blocked` (no 1-bit live-worker oracle) — pinned by Task 1 test `deleteBulk on a mixed batch: out-of-scope referenced ids are neither blocked nor applied`.
2. The intersect must not change in-scope results — the existing `deleteBulk splits applied and blocked across referenced positions` test must stay green untouched — pinned by Task 1 regression step.
3. `deleteWorker` on an already-deleted or missing id reports `"Worker not found."` — pinned by Task 2 test.
4. A position under a soft-deleted site but itself live+active must not reach the picker props — pinned by Task 3 tests on both pages.

---

### Task 1: Positions `deleteBulk` scope-intersect

**Files:**
- Modify: `app/dashboard/positions/actions.ts:262-305` (`deleteBulk`)
- Test: `app/dashboard/positions/bound-guard.test.ts` (extend)

**Interfaces:**
- Consumes: `positionBulkMutationWhere(actor, validIds)` from `@/lib/position-scope`; existing fixtures/helpers in `bound-guard.test.ts`.
- Produces: `deleteBulk(ids)` unchanged signature; new counting semantics — `blocked` counts only in-scope referenced ids; out-of-scope ids are dropped from both counters.

- [ ] **Step 1: Write the failing test**

Add to `bound-guard.test.ts` (reuse the existing fixture helpers; site B + referenced position PB + live worker under PB):

```ts
describe("position bound-guard", () => {
  test("deleteBulk on a mixed batch: out-of-scope referenced ids are neither blocked nor applied");
});
```

As the ho of site A: `deleteBulk([inScopeFree, inScopeReferenced, outOfScopeReferenced])` asserts `ok: true`, `applied === 1` (the free in-scope position) and `blocked === 1` (contracted to the in-scope referenced position only), plus all three rows still addressable: the two in-scope rows in their expected states (free one soft-deleted) and the foreign referenced position still live (`deletedAt` null).

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test app/dashboard/positions/bound-guard.test.ts`
Expected: FAIL — `blocked` is `2` today (out-of-scope id counted).

- [ ] **Step 3: Implement the intersect in `app/dashboard/positions/actions.ts`**

Inside `try`, before the grouped count: one select of live in-scope ids —

`db.select({ id: position.id }).from(position).where(and(inArray(position.id, validIds), isNull(position.deletedAt), positionBulkMutationWhere(actor, validIds)))` — then batch := that id set (rename minimally: the set feeds the existing `inArray(worker.positionId, …)` and the `freeIds` filter). Update the two comments (the "one grouped count" comment and the hold-back comment) to state that out-of-scope ids are dropped before counting, never reported. `deletePosition` is NOT touched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test app/dashboard/positions/bound-guard.test.ts && bun test app/dashboard/positions/`
Expected: PASS — the new test and every existing positions suite (including `deleteBulk splits applied and blocked across referenced positions`, whose batch is single-site) stay green.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/positions/actions.ts app/dashboard/positions/bound-guard.test.ts
git commit -m "fix(positions): drop out-of-scope ids before reporting deleteBulk blocked"
```

---

### Task 2: `deleteWorker` 0-rows net

**Files:**
- Modify: `app/dashboard/workers/actions.ts:294-320` (`deleteWorker`)
- Test: `app/dashboard/workers/actions.test.ts` (extend)

**Interfaces:**
- Consumes: existing `workerMutationWhere`, `workerOwnedByActor`, `dbResult`, fixture helpers.
- Produces: `deleteWorker(id)` unchanged signature; now answers `{ ok: false, message: "Worker not found." }` when its welded write touches 0 rows.

- [ ] **Step 1: Write the failing test**

Add to `actions.test.ts` (superadmin actor, no fixture row involved):

```ts
describe("worker actions", () => {
  test("deleteWorker on a missing worker: not found");
});
```

`deleteWorker(crypto.randomUUID())` asserts `ok === false` and `message === "Worker not found."`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test app/dashboard/workers/actions.test.ts`
Expected: FAIL — `ok` is `true` today.

- [ ] **Step 3: Implement the net**

In `deleteWorker`: add `.returning({ id: worker.id })` to the welded update; capture the rows and, when empty, return `{ ok: false, message: "Worker not found." }` inside the same `try`. Mirror `toggleWorker`'s shape directly above it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test app/dashboard/workers/actions.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/workers/actions.ts app/dashboard/workers/actions.test.ts
git commit -m "fix(workers): deleteWorker answers not found when the write touches 0 rows"
```

---

### Task 3: Soft-deleted-site positions out of the pickers

**Files:**
- Modify: `app/dashboard/workers/page.tsx` (~:156-193, positions fixture)
- Modify: `app/dashboard/positions/page.tsx` (positions fixture query)
- Test: `app/dashboard/workers/page.test.ts` (extend) and `app/dashboard/positions/page.test.ts` (extend)

**Interfaces:**
- Consumes: existing page-test fixtures and collector helpers.
- Produces: picker `positions` options that never include a live+active position whose site is soft-deleted.

- [ ] **Step 1: Write the failing tests**

`workers/page.test.ts` (fixtures `t13-wpage-`):

```ts
describe("workers page server queries", () => {
  test("pickers exclude positions under a soft-deleted site");
});
```

Fixture delta: add site B soft-deleted + location + one live+active position under it; assert superadmin's collector node `positions` does not contain that position (site A's do).

`positions/page.test.ts`: same-style test and fixture delta, same assertion, against its collector node.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test app/dashboard/workers/page.test.ts && bun test app/dashboard/positions/page.test.ts`
Expected: FAIL — the position arrives in the props today.

- [ ] **Step 3: Implement the guard**

In both pages' fixture positions query, add `isNull(site.deletedAt)` to the `and(...)` of the existing `site` join (one line each, alongside the existing commented guards, named branches unchanged).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test app/dashboard/workers/page.test.ts && bun test app/dashboard/positions/page.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `bun test && bun run lint && bun run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/workers/page.tsx app/dashboard/workers/page.test.ts app/dashboard/positions/page.tsx app/dashboard/positions/page.test.ts
git commit -m "fix(pickers): exclude positions under soft-deleted sites"
```
