# Worker Multi-Position Follow-ups — Design Spec

| | |
|---|---|
| Date | 2026-10-20 |
| Status | Design approved in chat; awaiting spec review |
| Scope | Test pins for position ordering and role-path pivot writes; accessible labelling of the position checkbox group |
| Related | `docs/specs/2026-10-20-worker-multi-position-design.md` (the feature these follow), `docs/architecture.md` §6, PR #103 |

## 1. Context

The multi-position feature (`worker_position` pivot, no primary position) shipped in PR #103. Its whole-branch review left four deferred minors. Three are closed here; the fourth stays out of scope (§5).

1. **The ordering test cannot fail.** `app/dashboard/workers/page.test.ts` → `each row carries its positions sorted by name` inserts `t13-wpage-beta` *after* the fixture's `t13-wpage-alpha`, so insertion order and name order coincide. Removing `.orderBy(asc(position.name))` from `page.tsx` was verified to leave the test green 5/5 on this database — the assertion does not pin the ORDER BY it claims to.
2. **Two role-path tests lost their position assertions.** Dropping `worker.position_id` removed the only position check from `superadmin create derives site from the location: round-trips` and `superadmin update moves the worker across sites and positions`; the latter's comment still promises that "site, location and position move together". Pivot persistence is pinned elsewhere for the shared write path, so this is redundant coverage — but the move test never held an old-site position to begin with, so its name overstates what it proves.
3. **The position checkbox group has no programmatic name.** The original feature spec (`2026-10-20-worker-multi-position-design.md` §7) requires a checkbox group labelled "Positions" and a checkbox `id` that includes the position id. Neither is implemented: `FieldLabel` has no `id`, `Field` (which already renders `role="group"`) has nothing pointing at it, and the checkboxes carry no `id`. Each checkbox is still operable and named by its wrapping `<label>`; what is missing is the group context for screen readers and the id hook.

No production behavior is wrong today. The problem is detection (1), documentation value of tests (2), and assistive-technology context (3).

## 2. Decisions (agreed in chat, 2026-10-20)

1. **Scope is these three items only.** No behavior, copy, schema, or migration change.
2. **The ordering fix changes the fixture, never the code.** The extra position is named to sort *before* the seeded one (`t13-wpage-aaa`) and is still inserted after it, so the two orders diverge.
3. **The ordering pin is proven by mutation**, not by a passing run: remove the `ORDER BY`, watch the test fail, restore it, watch it pass.
4. **The cross-site move test gets a real starting set** (`[posA]` in site A) so it proves replacement across a site change rather than a first insert. The dedicated `superadmin cross-site move rewrites the pivot site_id` test remains the primary pin.
5. **The group is labelled on the existing `Field`**, which already renders `role="group"`; no swap to `FieldSet`/`FieldLegend`.
6. **Checkbox ids come from the `id` prop**, which Base UI places on the hidden `input` — the labelable control the wrapping `<label>` already targets. No visual change.

## 3. Changes

### 3.1 Position ordering pin (test-only)

`app/dashboard/workers/page.test.ts`, test `each row carries its positions sorted by name`:

- Create an extra site-A position named `t13-wpage-aaa` and attach it to `wA` **after** the fixture has attached `t13-wpage-alpha`.
- Expect `["t13-wpage-aaa", "t13-wpage-alpha"]`, i.e. alphabetical, which is the reverse of insertion order.
- The existing cleanup already deletes the extra pivot row (by position id) and the position itself, so only the variable name changes.

`ORDER BY position.name` now produces `aaa` first. Without it, rows come back in the plan's order — empirically insertion order here — so the assertion fails.

### 3.2 Role-path pivot assertions (test-only)

`app/dashboard/workers/actions.test.ts`:

- **`superadmin create derives site from the location: round-trips`** — after reading the worker row, assert `pivotPositions(row.id)` yields `[fx.posA]` with `siteId === fx.siteA`. This pins that the superadmin path writes the pivot set, not just the worker row.
- **`superadmin update moves the worker across sites and positions`** — seed the worker through `seedWorkerWithPositions` with `positionIds: [fx.posA]` at `locA1`/`siteA` (instead of a bare worker insert), keep the move to `locB`/`siteB` with `[fx.posB]`, then assert the pivot holds exactly `[fx.posB]` and every `siteId === fx.siteB`. Rewrite the misleading comment to state what is asserted.
- Cleanup already drops pivot rows first via `dropWorkerById` / `dropWorkersByEmployeeId`, so no new cleanup line is needed.

### 3.3 Position checkbox group accessibility

`components/workers/worker-form.tsx`:

| Element | Change |
|---|---|
| `FieldLabel` (Positions) | gains `id="worker-positions-label"` |
| `Field` (already `role="group"`) | gains `aria-labelledby="worker-positions-label"` |
| `Checkbox` per option | gains `id={\`position-${option.id}\`}` |

- `components/ui/checkbox.tsx` needs no change: Base UI's `Checkbox.Root` renders a `<span>` plus a hidden `<input>`, and forwards `id` to that input.
- The group label renders in every state, including the "Select a location first" and empty-site branches, so `aria-labelledby` never dangles.
- New test in `components/workers/worker-form.test.tsx` (string assertions on the SSR output, matching the suite): every rendered option carries `id="position-<uuid>"`, and the markup contains `id="worker-positions-label"` together with `aria-labelledby="worker-positions-label"`.
- Rejected: `FieldSet`/`FieldLegend` — `Field` already owns `role="group"` and the `data-invalid` styling; nesting a fieldset inside it creates a second, unnamed group and a larger diff for no accessibility gain.

## 4. Acceptance criteria

- With `.orderBy(asc(position.name))` removed, the ordering test fails; with it restored, the test passes.
- The two role tests fail if their action stops writing or replacing pivot rows (verified by the assertions themselves; the move test's fixture now holds a pre-move set).
- Rendered worker form: each position checkbox has `id="position-<uuid>"`; the group has `role="group"` and `aria-labelledby="worker-positions-label"`, which names an existing element whose text is "Positions".
- `bun run lint`, `bun test`, `bun run build` are green.
- No production behavior, copy string, schema, or migration changes.

## 5. Out of scope

- **An attached position that is soft-deleted leaves an invisible id in `positionIds`**, so the worker form cannot be saved (`Position must be in the same site as the location`) and the user cannot remove it. Reachable only through the position-delete guard's check-then-write race; fixing it needs a copy decision (a rendered `(unavailable)` row or a silent drop).
- **The position-delete guard's TOCTOU** itself (check-then-soft-delete outside a transaction).
- **`aria-invalid` on individual checkboxes** when `fieldErrors.positionIds` is set (original spec §7). A separate gap: the field-level `FieldError` is still announced, and adding per-checkbox invalid state would change the visual error treatment.
- Any change to position ordering semantics, the pivot write path, or the position catalog.

## 6. Verification

```bash
bun run lint      # 0 errors; one pre-existing warning in lib/engine/validate.ts
bun test          # all suites green, including the three touched test files
bun run build     # success
```

The ordering pin additionally requires the mutation check in §3.1 during implementation; a green suite alone does not satisfy it.
