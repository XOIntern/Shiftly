import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { position } from "./position-schema";
import { site, siteLocation } from "./site-schema";

// Workers are site_location-scoped rows — the unit the roster engine
// schedules (they never log in). The site_location FK pins the location onto
// the SAME site as the denormalized site_id — cross-site pairing is
// impossible even by direct insert (23503), pinned in lib/worker-fk.test.ts.
// A worker's qualifications are a SET: the positions live in worker_position
// (multi-position spec, 2026-10-20) with no primary and no order.

export const worker = pgTable(
  "worker",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    employeeId: text("employee_id").notNull(),
    name: text("name").notNull(),
    contractEndDate: date("contract_end_date"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    // Resolves worker_position_worker_site_fk against (id, site_id).
    unique("worker_id_site_id_unique").on(table.id, table.siteId),
    uniqueIndex("worker_site_location_id_employee_id_unique")
      .on(table.siteLocationId, table.employeeId)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "worker_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
  ],
);

// The worker's qualification set: one row per position the worker holds.
// Both composite FKs weld the pair to a single site — a cross-site pair is
// impossible even by direct insert (23503) and the PK rejects a duplicate
// pair (23505). Both are pinned in lib/worker-fk.test.ts.
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

// Relations live here rather than in site-schema.ts / position-schema.ts:
// extending those relations to cover workers would make them import this
// file and create an evaluation cycle (drizzle's relation references
// resolve eagerly). Dependency stays one-way: worker-schema →
// site-schema, position-schema. The barrel re-exports everything, and no
// consumer imports the relations symbols directly.
export const workerRelations = relations(worker, ({ one, many }) => ({
  siteLocation: one(siteLocation, {
    fields: [worker.siteLocationId],
    references: [siteLocation.id],
  }),
  site: one(site, {
    fields: [worker.siteId],
    references: [site.id],
  }),
  positions: many(workerPosition),
}));

export const workerPositionRelations = relations(workerPosition, ({ one }) => ({
  worker: one(worker, {
    fields: [workerPosition.workerId],
    references: [worker.id],
  }),
  position: one(position, {
    fields: [workerPosition.positionId],
    references: [position.id],
  }),
}));
