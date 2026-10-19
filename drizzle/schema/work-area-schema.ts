import { relations, sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { site, siteLocation } from "./site-schema";

// Work areas (dropped-department epic, 2026-10-19). `work_area` is a
// site_location-scoped area managed by that location's admin. The composite
// FK pins the site_location onto the SAME site as the denormalized site_id —
// cross-site pairing is impossible even by direct insert (23503), pinned in
// lib/work-area-fk.test.ts.

export const workArea = pgTable(
  "work_area",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    uniqueIndex("work_area_site_location_id_name_unique")
      .on(table.siteLocationId, table.name)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "work_area_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
  ],
);

// Relations live here rather than in site-schema.ts: extending the site /
// site_location relations to cover work areas would make site-schema import
// this file and create an evaluation cycle (drizzle's relation references
// resolve eagerly). Dependency stays one-way: work-area-schema →
// site-schema. The barrel re-exports everything, and no consumer imports
// the relations symbols directly.
export const workAreaRelations = relations(workArea, ({ one }) => ({
  siteLocation: one(siteLocation, {
    fields: [workArea.siteLocationId],
    references: [siteLocation.id],
  }),
  site: one(site, {
    fields: [workArea.siteId],
    references: [site.id],
  }),
}));

export const siteRelations = relations(site, ({ many }) => ({
  locations: many(siteLocation),
  workAreas: many(workArea),
}));

export const siteLocationRelations = relations(siteLocation, ({ one, many }) => ({
  site: one(site, {
    fields: [siteLocation.siteId],
    references: [site.id],
  }),
  workAreas: many(workArea),
}));
