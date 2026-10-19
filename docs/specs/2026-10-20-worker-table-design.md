# Worker Table — Design Spec

| | |
|---|---|
| Date | 2026-10-20 |
| Status | Design approved in chat; awaiting implementation |
| Scope | New `worker` table, supporting change to `position`, migration, FK pin test |
| Related | `docs/architecture.md` §4 (Master Data), §6 (Data Model), §11 (sensitive data) |

## 1. Context

Workers are the unit Shiftly rosters: outsourced workers managed per `site_location`, who never log in. The table is already anticipated across the codebase:

- `drizzle/schema/position-schema.ts` — "workers — once the worker table exists — will reference a position of their own site."
- `app/dashboard/positions/actions.ts` — the position bound-guard "lands with the worker table".
- `app/dashboard/workers/page.tsx` — placeholder stub page.
- `lib/engine/validate.ts` — the engine's `WorkerProfile` consumes workers for rule C7.

This spec covers the table only. CRUD UI, work-area placement, and additional attributes are follow-ups (§7).

## 2. Decisions (agreed in chat, 2026-10-20)

1. **`employee_id` is unique per `site_location`** — two locations in the same site may reuse an ID. Rationale: workers are location-level operational data; each admin manages and imports their own location's workers. A person's globally-unique identifier (NIK) is not part of this table for now.
2. **Work-area placement is not on the worker table.** A separate placement table comes later; rule C7 will read placement through a join. A worker is strictly a `site_location`-scoped row.
3. **The only extra attribute for now is `contract_end_date`** (nullable). NIK, employment status (PKWT/PKWTT), join date, and qualifications are deferred.
4. **`position_id` references the existing per-site `position` catalog**, with the DB-level same-site guarantee (the `work_area` composite-FK pattern), not a free-text field.

## 3. Table definition — new file `drizzle/schema/worker-schema.ts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | `defaultRandom()` |
| `site_location_id` | uuid, NOT NULL | paired in composite FK, see §4 |
| `site_id` | uuid, NOT NULL | denormalized, shared by both composite FKs, see §4 |
| `employee_id` | text, NOT NULL | business ID entered by the admin |
| `name` | text, NOT NULL | |
| `position_id` | uuid, NOT NULL | paired in composite FK, see §4 |
| `contract_end_date` | date, NULL | |
| `is_active` | boolean, NOT NULL, default true | |
| `created_at` | timestamp, NOT NULL, default now | |
| `updated_at` | timestamp, NOT NULL, default now, `$onUpdate` | per existing tables |
| `deleted_at` | timestamp, NULL | soft delete |

## 4. Constraints and indexes

Both same-site guarantees hinge on the denormalized `site_id`; each composite FK pins one parent to it.

1. **Partial unique** `worker_site_location_id_employee_id_unique` on `(site_location_id, employee_id)` `WHERE deleted_at IS NULL` — soft-deleted rows free their ID.
2. **Composite FK** `worker_site_location_site_fk` on `(site_location_id, site_id)` → `site_location (id, site_id)`, ON DELETE RESTRICT — exact `work_area_site_location_site_fk` pattern; a location from another site is impossible even by direct insert (23503).
3. **Composite FK** `worker_position_site_fk` on `(position_id, site_id)` → `position (id, site_id)`, ON DELETE RESTRICT — a position from another site is equally impossible.

## 5. Changes to existing schema

- `drizzle/schema/position-schema.ts`: add plain (non-partial) unique constraint `position_id_site_id_unique` on `(id, site_id)` — mirrors `site_location_id_site_id_unique` on `site_location`, required so the composite FK resolves at FK-creation time.
- `drizzle/schema/index.ts`: add `export * from "./worker-schema"`.

## 6. Relations

`workerRelations` defined in `worker-schema.ts`: `one` siteLocation, `one` site, `one` position. No edits to other relations objects (the position-schema precedent: relations live in the child file to keep dependencies one-way and avoid evaluation cycles).

## 7. Out of scope (follow-ups, not reopened here)

- `/dashboard/workers` CRUD (stub page exists; the positions bound-guard upgrade lands with it).
- Work-area placement table (the C7 join target).
- NIK, employment status (PKWT/PKWTT), join date, qualifications.
- CSV/Excel worker import.

## 8. Testing

DB-backed test, pattern of `lib/work-area-fk.test.ts`:

1. Inserting a worker whose position belongs to a **different site** than the worker's `site_id` fails with 23503.
2. Inserting a worker whose `site_location` belongs to a **different site** than the worker's `site_id` fails with 23503.
3. A valid same-site insert succeeds.
4. Duplicate `(site_location_id, employee_id)` among live rows is rejected; allowed again after soft delete.

`bun test`, `bun run lint`, and `bun run build` green before completion.

## 9. Migration

`bun run db:generate` → review generated SQL → `bun run db:migrate`. Migration files are committed — they ship in the production image: the `compose.prod.yaml` entrypoint runs `drizzle-kit migrate` before `next start`.
