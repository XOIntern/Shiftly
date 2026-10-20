# Worker Multi-Position Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three deferred review findings from the multi-position PR: make the position-ordering test actually fail without its `ORDER BY`, restore pivot assertions on the superadmin create/move tests, and give the worker position checkbox group a programmatic name plus per-checkbox ids.

**Architecture:** No production behavior changes. Two tasks are test-only (a fixture whose insertion order diverges from name order; two assertions with a mutation check proving they bite). The third touches one form block: the existing `Field` already renders `role="group"`, so it gains `aria-labelledby`, its `FieldLabel` gains that id, and each Base UI `Checkbox` receives `id="position-<uuid>"` (Base UI forwards `id` to its hidden input).

**Tech Stack:** Bun test runner, Next.js 16 App Router server components, Base UI (`@base-ui/react`) Checkbox inside shadcn/ui `Field`/`FieldLabel`, Drizzle-backed integration tests against the compose Postgres.

**Spec:** `docs/specs/2026-10-20-worker-multi-position-followups-design.md`

## Global Constraints

- Bun only: `bun test`, `bun run lint`, `bun run build` — never npm/yarn/pnpm.
- DB-backed suites need the compose Postgres (`docker compose up -d`) and hit the shared dev database: keep the existing fixture prefixes (`t13-wpage-`, `t11-wact-`) and delete every row each test creates.
- Test output shape is Bun's: `N pass` / `N fail` lines; a filtered run also prints `M filtered out`.
- No copy string, schema, migration, or server-action change. The exact strings already in the suite stay verbatim.
- Base UI `Checkbox.Root` renders a `<span>` plus a hidden `<input>`; the `id` prop lands on that input, which is the labelable control of the wrapping `<label>`.
- Never stage or commit globally-gitignored files; run `git check-ignore -v <path>` before adding an unfamiliar path.
- Mutation steps (temporary removal of code to prove a test fails) must be restored exactly; the final `git diff` of a task contains only that task's intended changes.

## Review Focus

Failure modes the spec implies; each is pinned by a test in the owning task.

1. A future refactor drops `.orderBy(asc(position.name))` and the suite stays green, so positions render unsorted — pinned by Task 1's mutation check (test must fail without the clause).
2. `createWorker`/`updateWorker` stop writing or replacing pivot rows and no role-path test notices — pinned by Task 2's assertions plus its two-insert mutation check.
3. The group's `aria-labelledby` points at an element that is not rendered in some branch (no site picked, no positions for the site), leaving a dangling reference — pinned by Task 3's empty-state test.
4. Two rendered options share an id, breaking label association — pinned by Task 3's two-attached-positions test asserting both ids.
5. The new `id` props disturb checked-state rendering — pinned by the existing `an edit with two attached positions renders both checked` test. Label-click behaviour is not pinned: this suite has no DOM environment (no jsdom/testing-library), so the SSR assertion cannot click; production risk is nil because the label/checkbox nesting is unchanged.

---

### Task 1: Pin the position ordering

**Files:**
- Modify: `app/dashboard/workers/page.test.ts:283-317` (test `each row carries its positions sorted by name`)
- Temporarily modify, then restore: `app/dashboard/workers/page.tsx:245-257` (the pivot follow-up query)

**Interfaces:**
- Consumes: `seedWorkerFixtures()` from the same file (returns `ids.siteA`, `ids.wA`), `db`, `position`, `workerPosition`.
- Produces: nothing importable — a test that fails when the ORDER BY is missing.

- [ ] **Step 1: Change the fixture so insertion order and name order diverge**

Replace the test body with (variable renamed `beta` → `aaa`, name chosen to sort before `t13-wpage-alpha`):

```ts
  test("each row carries its positions sorted by name", async () => {
    const fx = await seedWorkerFixtures();
    const aaa = randomUUID();

    try {
      await db.insert(position).values({
        id: aaa,
        siteId: fx.ids.siteA,
        name: "t13-wpage-aaa",
      });
      await db.insert(workerPosition).values({
        workerId: fx.ids.wA,
        positionId: aaa,
        siteId: fx.ids.siteA,
      });

      actor = makeActor("superadmin", null, null);

      const page = await renderWorkers({ siteId: fx.ids.siteA });
      const row = page.workers.find((w) => w.id === fx.ids.wA);
      expect(row?.positions?.map((p) => p.name)).toEqual([
        "t13-wpage-aaa",
        "t13-wpage-alpha",
      ]);
    } finally {
      // The local position (and its pivot row) go before the site dies.
      await db
        .delete(workerPosition)
        .where(eq(workerPosition.positionId, aaa));
      await db.delete(position).where(eq(position.id, aaa));
      await fx.cleanup();
    }
  });
```

- [ ] **Step 2: Run the test against unchanged code**

Run: `bun test app/dashboard/workers/page.test.ts -t "positions sorted by name"`
Expected: PASS (`1 pass`, `0 fail`) — the fixture change alone does not alter behaviour.

- [ ] **Step 3: Prove the pin by mutation**

Delete the line `.orderBy(asc(position.name));` from the pivot follow-up query in `page.tsx` (the `select(...).from(workerPosition).innerJoin(...)` statement), then run the same command.

Expected: FAIL — received `["t13-wpage-alpha", "t13-wpage-aaa"]` against expected `["t13-wpage-aaa", "t13-wpage-alpha"]`.

- [ ] **Step 4: Restore the ORDER BY exactly and re-run**

Restore `.orderBy(asc(position.name));` on that query.

Run: `bun test app/dashboard/workers/page.test.ts -t "positions sorted by name"`
Expected: PASS. Confirm `git diff app/dashboard/workers/page.tsx` is empty.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/workers/page.test.ts
git commit -m "test(workers): pin the position ordering by name"
```

---

### Task 2: Assert pivot writes on the superadmin create and move paths

**Files:**
- Modify: `app/dashboard/workers/actions.test.ts:165-202` (test `superadmin create derives site from the location: round-trips`)
- Modify: `app/dashboard/workers/actions.test.ts:423-469` (test `superadmin update moves the worker across sites and positions`)
- Temporarily modify, then restore: `app/dashboard/workers/actions.ts` (the two `tx.insert(workerPosition)` calls)

**Interfaces:**
- Consumes: `pivotPositions(workerId)` (same file; returns `{ id, siteId, name }[]` ordered by position name), `seedWorkerWithPositions({ siteLocationId, siteId, employeeId, name, positionIds })`, `seedGlobalData()`.
- Produces: nothing importable — two assertions that fail if the action stops writing the pivot.

- [ ] **Step 1: Add the create-path assertion**

After the existing `expect(row.deletedAt).toBeNull();` in the superadmin create test, add:

```ts
      const pivot = await pivotPositions(row.id);
      expect(pivot.map((p) => p.id)).toEqual([fx.posA]);
      expect(pivot.every((p) => p.siteId === fx.siteA)).toBe(true);
```

- [ ] **Step 2: Give the move test a real starting set and assert the replacement**

Replace the bare `db.insert(worker).values({...})` setup with a seeded set, and add the pivot assertions after the existing row assertions:

```ts
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mov",
      name: "T11 Wact Worker Mov",
      positionIds: [fx.posA],
    });
```

```ts
      // The old site-A set is replaced, not appended to: the pivot carries
      // exactly the new position, welded to the new site.
      const pivot = await pivotPositions(wid);
      expect(pivot.map((p) => p.id)).toEqual([fx.posB]);
      expect(pivot.every((p) => p.siteId === fx.siteB)).toBe(true);
```

The existing `dropWorkerById(wid)` cleanup already deletes pivot rows before the worker, so no cleanup change is needed.

- [ ] **Step 3: Run both tests against unchanged code**

Run: `bun test app/dashboard/workers/actions.test.ts -t "superadmin create derives site" && bun test app/dashboard/workers/actions.test.ts -t "moves the worker across sites"`
Expected: both PASS.

- [ ] **Step 4: Prove both assertions bite by mutation**

Comment out the `await tx.insert(workerPosition).values(...)` block in **both** `createWorker` and `updateWorker` inside `app/dashboard/workers/actions.ts`, then run the two commands from Step 3.

Expected: both FAIL — the create test receives an empty pivot, the move test receives an empty pivot. Restore both blocks exactly and re-run; expected PASS. Confirm `git diff app/dashboard/workers/actions.ts` is empty.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/workers/actions.test.ts
git commit -m "test(workers): pin pivot writes on the superadmin create and move paths"
```

---

### Task 3: Name the position checkbox group and id each checkbox

**Files:**
- Modify: `components/workers/worker-form.test.tsx` (add two tests to `describe("WorkerForm position checkboxes", ...)`)
- Modify: `components/workers/worker-form.tsx:385-412` (the Positions `Field` block)

**Interfaces:**
- Consumes: existing `renderForm`, `editWorker`, `allPositions`, `sites`, `allLocations`, and the `POS_A1` / `POS_A2` constants from the test file.
- Produces: rendered markup only — `id="worker-positions-label"`, `aria-labelledby="worker-positions-label"`, `id="position-<uuid>"` per checkbox. No exported signature changes.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe("WorkerForm position checkboxes", ...)`:

```ts
  test("each checkbox carries its position id and the group is named", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: {
        ...editWorker,
        positions: [
          { id: POS_A1, name: "Position Alpha One", isActive: true },
          { id: POS_A2, name: "Position Alpha Two", isActive: false },
        ],
      },
    });

    expect(html.includes(`id="position-${POS_A1}"`)).toBeTrue();
    expect(html.includes(`id="position-${POS_A2}"`)).toBeTrue();
    expect(html.includes('id="worker-positions-label"')).toBeTrue();
    expect(html.includes('aria-labelledby="worker-positions-label"')).toBeTrue();
  });

  test("the group keeps its label when the site has no positions", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: [],
      worker: editWorker,
    });

    expect(html.includes('id="worker-positions-label"')).toBeTrue();
    expect(html.includes('aria-labelledby="worker-positions-label"')).toBeTrue();
    expect(html.includes("No positions for this site yet")).toBeTrue();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test components/workers/worker-form.test.tsx -t "checkbox carries its position id" && bun test components/workers/worker-form.test.tsx -t "keeps its label when the site has no positions"`
Expected: both FAIL — `id="position-…"` and `aria-labelledby` are absent (the second test's third assertion already passes).

- [ ] **Step 3: Implement the labelling**

In the Positions block of `worker-form.tsx`:

- `<FieldLabel>` → `<FieldLabel id="worker-positions-label">Positions</FieldLabel>`
- `<Field data-invalid={...}>` → add `aria-labelledby="worker-positions-label"` (the component already renders `role="group"`)
- Inside the option map, `<Checkbox` → add `id={`position-${option.id}`}`

No change to `components/ui/checkbox.tsx` or `components/ui/field.tsx`.

- [ ] **Step 4: Run the form suite to verify they pass**

Run: `bun test components/workers/worker-form.test.tsx`
Expected: all tests PASS, including the existing `an edit with two attached positions renders both checked` and `an attached inactive position renders with (inactive)`.

- [ ] **Step 5: Run the whole gate**

Run: `bun run lint && bun test && bun run build`
Expected: lint 0 errors (one pre-existing warning in `lib/engine/validate.ts`), all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add components/workers/worker-form.tsx components/workers/worker-form.test.tsx
git commit -m "fix(ui): name the worker position checkbox group and id each box"
```

---

## Execution notes

- Tasks are independent; 1→2→3 keeps the three commits in spec order. Each ends with its own commit on `feat/worker-multi-position`.
- The mutation steps in Tasks 1 and 2 are temporary and must be restored before the commit; the commit's `git add` lists only the test file, but verify `git status --short` is clean for production files anyway.
- `docs/specs/2026-10-20-worker-multi-position-followups-design.md` is the binding document; if a step contradicts it, the spec wins and the contradiction is ruled on in the execution ledger.
- Handoff (not a task): pushing the branch and updating PR #103's body happens only after the human partner approves this plan.
