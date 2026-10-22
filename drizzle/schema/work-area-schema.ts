import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
    // Resolves dependent weld FKs against (id, site_location_id, site_id)
    // — mp_request_line welds here; the roster spec reuses it.
    unique("work_area_id_site_location_id_site_id_unique").on(
      table.id,
      table.siteLocationId,
      table.siteId,
    ),
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

// The work area's position set (roster spec §3.1, C7 activation): one row
// per position the area draws from — mirrors worker_position, empty = C7
// no-op for the area. Both FKs weld the pair to a single site — a
// cross-site pairing is impossible even by direct insert (23503) and the
// PK rejects a duplicate pair (23505).
export const workAreaPosition = pgTable(
  "work_area_position",
  {
    workAreaId: uuid("work_area_id").notNull(),
    positionId: uuid("position_id").notNull(),
    siteId: uuid("site_id").notNull(),
    siteLocationId: uuid("site_location_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workAreaId, table.positionId] }),
    index("work_area_position_position_id_idx").on(table.positionId),
    foreignKey({
      name: "work_area_position_work_area_weld_fk",
      columns: [table.workAreaId, table.siteLocationId, table.siteId],
      foreignColumns: [workArea.id, workArea.siteLocationId, workArea.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_area_position_position_site_fk",
      columns: [table.positionId, table.siteId],
      foreignColumns: [position.id, position.siteId],
    }).onDelete("restrict"),
  ],
);

// Relations live here rather than in site-schema.ts: extending the site /
// site_location relations to cover work areas would make site-schema import
// this file and create an evaluation cycle (drizzle's relation references
// resolve eagerly). Dependency stays one-way: work-area-schema →
// site-schema, position-schema. The barrel re-exports everything, and no
// consumer imports the relations symbols directly.
export const workAreaRelations = relations(workArea, ({ one, many }) => ({
  siteLocation: one(siteLocation, {
    fields: [workArea.siteLocationId],
    references: [siteLocation.id],
  }),
  site: one(site, {
    fields: [workArea.siteId],
    references: [site.id],
  }),
  positions: many(workAreaPosition),
}));

export const workAreaPositionRelations = relations(
  workAreaPosition,
  ({ one }) => ({
    workArea: one(workArea, {
      fields: [workAreaPosition.workAreaId],
      references: [workArea.id],
    }),
    position: one(position, {
      fields: [workAreaPosition.positionId],
      references: [position.id],
    }),
  }),
);

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
