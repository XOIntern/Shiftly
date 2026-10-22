import { relations, sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { siteLocation } from "./site-schema";

// Shift definitions (Module 3, mp-requests epic): per-site_location shift
// master data — the labeled day slots the roster engine places workers into
// and the MP-request lines weld onto via (id, site_location_id, site_id).
// The composite FK pins the site_location onto the SAME site as the
// denormalized site_id — cross-site pairing is impossible even by direct
// insert (23503). The composite unique on (id, site_location_id, site_id)
// lets dependents weld to a single site, and the partial unique frees a
// location's order_index slot once its shift is soft-deleted.

export const shiftDefinition = pgTable(
  "shift_definition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    label: text("label").notNull(),
    orderIndex: smallint("order_index").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    // Resolves dependent weld FKs against (id, site_location_id, site_id).
    unique("shift_definition_id_site_location_id_site_id_unique").on(
      table.id,
      table.siteLocationId,
      table.siteId,
    ),
    uniqueIndex("shift_definition_site_location_id_order_index_unique")
      .on(table.siteLocationId, table.orderIndex)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "shift_definition_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
  ],
);

// Relations live here rather than in site-schema.ts: extending the site /
// site_location relations to cover shift definitions would make site-schema
// import this file and create an evaluation cycle (drizzle's relation
// references resolve eagerly). Dependency stays one-way: shift-schema →
// site-schema. The barrel re-exports everything, and no consumer imports
// the relations symbols directly.
export const shiftDefinitionRelations = relations(shiftDefinition, ({ one }) => ({
  siteLocation: one(siteLocation, {
    fields: [shiftDefinition.siteLocationId],
    references: [siteLocation.id],
  }),
}));
