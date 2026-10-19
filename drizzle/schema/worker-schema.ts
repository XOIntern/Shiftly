import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { position } from "./position-schema";
import { site, siteLocation } from "./site-schema";

// Workers are site_location-scoped rows — the unit the roster engine
// schedules (they never log in). The two composite FKs pin both the
// site_location and the position onto the SAME site as the denormalized
// site_id — cross-site pairing is impossible even by direct insert (23503),
// pinned in lib/worker-fk.test.ts.

export const worker = pgTable(
  "worker",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    employeeId: text("employee_id").notNull(),
    name: text("name").notNull(),
    positionId: uuid("position_id").notNull(),
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
    uniqueIndex("worker_site_location_id_employee_id_unique")
      .on(table.siteLocationId, table.employeeId)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "worker_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "worker_position_site_fk",
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
export const workerRelations = relations(worker, ({ one }) => ({
  siteLocation: one(siteLocation, {
    fields: [worker.siteLocationId],
    references: [siteLocation.id],
  }),
  site: one(site, {
    fields: [worker.siteId],
    references: [site.id],
  }),
  position: one(position, {
    fields: [worker.positionId],
    references: [position.id],
  }),
}));
