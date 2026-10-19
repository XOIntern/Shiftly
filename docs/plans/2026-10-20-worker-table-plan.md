# Worker Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `worker` table — site_location-scoped, soft-deleted, position pinned to the same site — with its migration and DB-level FK pin tests.

**Architecture:** New Drizzle schema file mirroring `work-area-schema.ts`: denormalized `site_id` shared by two composite FKs that pin both the `site_location` and the `position` to the same site at the DB level (23503 on any cross-site pairing), plus a partial unique index for `employee_id` per location. The `position` table gains the plain `(id, site_id)` unique constraint the composite FK resolves against.

**Tech Stack:** Drizzle ORM + drizzle-kit, PostgreSQL 18 (compose), Bun test runner.

**Spec:** `docs/specs/2026-10-20-worker-table-design.md`

## Global Constraints

- Bun only: `bun install`, `bun test`, `bun run db:generate`, `bun run db:migrate`, `bun run lint`, `bun run build` — never npm/yarn/pnpm.
- DB-backed tests need the compose Postgres up: `docker compose up -d`.
- Existing schema conventions, verbatim: uuid PK `defaultRandom()`; `is_active` NOT NULL default `true`; `created_at`/`updated_at` default now with `$onUpdate`; `deleted_at` nullable (soft delete); partial uniques `WHERE deleted_at is null`; every FK `ON DELETE RESTRICT`.
- Exact names (pinned by the spec §4): table `worker`; unique index `worker_site_location_id_employee_id_unique`; FKs `worker_site_location_site_fk`, `worker_position_site_fk`; unique constraint `position_id_site_id_unique`.
- One-way schema dependencies: `worker-schema` imports `./site-schema` and `./position-schema`; `workerRelations` lives in `worker-schema.ts`; do NOT touch `siteRelations`/`siteLocationRelations` (evaluation-cycle rule, see comments in `work-area-schema.ts` and `position-schema.ts`).
- Migration files are committed — they ship in the production image.
- Never stage or commit globally-ignored files; verify unfamiliar paths with `git check-ignore -v <path>` before `git add`.

## Review Focus

Failure modes the spec implies; each is pinned by a test or check in Task 1.

1. Position from a different site than the worker's `site_id` must be rejected 23503 — pinned by test `position from site B + site_id = A: rejected with 23503`.
2. Site_location from a different site than the worker's `site_id` must be rejected 23503 — pinned by test `site_location from site B + site_id = A: rejected with 23503`.
3. The same `employee_id` under a different site_location of the same site must SUCCEED (uniqueness is per location, not per site) — pinned by test `same employee_id under another location of the same site: allowed`.
4. Deleting a site_location that still has live workers must 23503 (ON DELETE RESTRICT) — pinned by test `deleting a site_location with live workers: rejected with 23503`.
5. `drizzle-kit generate` emitting unrelated schema drift into the migration — pinned by the manual SQL review step (Task 1, Step 5).

---

### Task 1: Worker schema, position unique constraint, migration, FK pin tests

**Files:**
- Create: `drizzle/schema/worker-schema.ts`
- Create: `lib/worker-fk.test.ts` (pattern: `lib/work-area-fk.test.ts`)
- Modify: `drizzle/schema/position-schema.ts` (add the `(id, site_id)` unique constraint)
- Modify: `drizzle/schema/index.ts` (add barrel export)
- Generated: `drizzle/migrations/<next-number>_<name>.sql` + `drizzle/migrations/meta/` updates

**Interfaces:**
- Consumes: `site`, `siteLocation` from `./site-schema`; `position` from `./position-schema`; `db` from `lib/db`; `pgErrorCode` from `lib/db-errors` (same imports as `lib/work-area-fk.test.ts`).
- Produces: `worker` pgTable (columns per spec §3), `workerRelations` (one siteLocation, one site, one position), barrel re-export. Later tasks (worker CRUD, placement table) import `worker` from `../drizzle/schema` — the relative barrel path existing tests like `lib/work-area-fk.test.ts` already use.

- [ ] **Step 1: Write the failing test `lib/worker-fk.test.ts`**

Mirror `lib/work-area-fk.test.ts` exactly: `import "dotenv/config"`, `randomUUID` fixtures with a `run`-prefixed unique `name` per row, inserts through the schema barrel, `pgErrorCode(err)` capture, `try/finally` cleanup deleting children before parents. Six tests in one describe block:

```ts
describe("worker composite-FK & unique guards (worker table spec, 2026-10-20)", () => {
  // fixture per test: site A + site B (+ position on site B where needed),
  // site_location on one of them, then the worker insert under test
  test("position from site B + site_id = A: rejected with 23503", ...)   // expect(code).toBe("23503"), nothing left behind
  test("site_location from site B + site_id = A: rejected with 23503", ...)
  test("positive control: same-site location + position round-trips", ...) // row.siteLocationId/siteId round-trip, isActive true, deletedAt null
  test("same employee_id under another location of the same site: allowed", ...) // both inserts succeed
  test("duplicate employee_id in one location: rejected with 23505, freed after soft delete", ...)
    // 2nd live insert → 23505; set deletedAt on the 1st → re-insert succeeds
  test("deleting a site_location with live workers: rejected with 23503", ...)
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose up -d && bun test lib/worker-fk.test.ts`
Expected: FAIL — `worker` does not exist in the schema barrel (import is undefined / insert throws "table does not exist").

- [ ] **Step 3: Add `position_id_site_id_unique` to `drizzle/schema/position-schema.ts`**

In the table's third argument array, next to the existing unique index, add (import `unique` from `drizzle-orm/pg-core`):

```ts
unique("position_id_site_id_unique").on(table.id, table.siteId),
```

Carry over the comment pattern from `site-schema.ts` (`site_location_id_site_id_unique`): plain constraint so the composite FK from `worker` resolves at FK-creation time.

- [ ] **Step 4: Create `drizzle/schema/worker-schema.ts` and wire the barrel**

Table per spec §3 with the constraint names from Global Constraints; relations per spec §6:

```ts
export const worker = pgTable("worker", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteLocationId: uuid("site_location_id").notNull(),
  siteId: uuid("site_id").notNull(),
  employeeId: text("employee_id").notNull(),
  name: text("name").notNull(),
  positionId: uuid("position_id").notNull(),
  contractEndDate: date("contract_end_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  uniqueIndex("worker_site_location_id_employee_id_unique")
    .on(table.siteLocationId, table.employeeId)
    .where(sql`deleted_at is null`),
  foreignKey({ name: "worker_site_location_site_fk",
    columns: [table.siteLocationId, table.siteId],
    foreignColumns: [siteLocation.id, siteLocation.siteId] }).onDelete("restrict"),
  foreignKey({ name: "worker_position_site_fk",
    columns: [table.positionId, table.siteId],
    foreignColumns: [position.id, position.siteId] }).onDelete("restrict"),
]);

export const workerRelations = relations(worker, ({ one }) => ({
  siteLocation: one(siteLocation, { fields: [worker.siteLocationId], references: [siteLocation.id] }),
  site: one(site, { fields: [worker.siteId], references: [site.id] }),
  position: one(position, { fields: [worker.positionId], references: [position.id] }),
}));
```

Header comment in the file states the one-line purpose (site_location-scoped workers; composite FKs pin location and position to the denormalized site) in the style of `work-area-schema.ts`. Add `export * from "./worker-schema";` to `drizzle/schema/index.ts` (alphabetical: after `./rule-config-schema` imports stay ordered like the current file — append last, matching its plain-list style).

- [ ] **Step 5: Generate and review the migration**

Run: `bun run db:generate`
Review the new `drizzle/migrations/<next-number>_<name>.sql`: it must contain ONLY the `CREATE TABLE "worker"` statements, the two composite FKs, the partial unique index, and `ALTER TABLE "position" ADD CONSTRAINT "position_id_site_id_unique"`. Any unrelated drift → STOP, do not commit; investigate before proceeding.

- [ ] **Step 6: Apply the migration**

Run: `bun run db:migrate`
Expected: migration applied cleanly.

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test lib/worker-fk.test.ts`
Expected: 6 pass.

- [ ] **Step 8: Full verification**

Run: `bun test && bun run lint && bun run build`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add drizzle/schema/worker-schema.ts drizzle/schema/position-schema.ts \
  drizzle/schema/index.ts drizzle/migrations lib/worker-fk.test.ts
git commit -m "feat(db): add worker table with same-site position & location FKs"
```
