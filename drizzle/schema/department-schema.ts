import { relations, sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { site, siteLocation } from "./site-schema";

// Departments & work areas epic (GitHub #57, task #58). `department` is a
// site-scoped HR grouping managed by the site's ho; `work_area` is a
// department+site_location-scoped area managed by that location's admin.
// The two composite FKs on work_area pin the department and the site_location
// onto the SAME site — cross-site pairing is impossible even by direct insert
// (23503), pinned in lib/work-area-fk.test.ts.

export const department = pgTable(
  "department",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "restrict" }),
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
    // Plain (non-partial) unique CONSTRAINT on the parent pair so the
    // composite FK from work_area(department_id, site_id) resolves — a
    // unique INDEX emitted by drizzle-kit lands after the ALTER-FK
    // statements, which Postgres rejects. Inline constraints exist by the
    // time the FKs are added.
    unique("department_id_site_id_unique").on(table.id, table.siteId),
    uniqueIndex("department_site_id_name_unique")
      .on(table.siteId, table.name)
      .where(sql`deleted_at is null`),
  ],
);

export const workArea = pgTable(
  "work_area",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id").notNull(),
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
      name: "work_area_department_site_fk",
      columns: [table.departmentId, table.siteId],
      foreignColumns: [department.id, department.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "work_area_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
  ],
);

// Relations live here rather than in site-schema.ts: extending the site /
// site_location relations to cover departments/work areas would make
// site-schema import this file and create an evaluation cycle (drizzle's
// relation references resolve eagerly). Dependency stays one-way:
// department-schema → site-schema. The barrel re-exports everything, and no
// consumer imports the relations symbols directly.
export const departmentRelations = relations(department, ({ one, many }) => ({
  site: one(site, {
    fields: [department.siteId],
    references: [site.id],
  }),
  workAreas: many(workArea),
}));

export const workAreaRelations = relations(workArea, ({ one }) => ({
  department: one(department, {
    fields: [workArea.departmentId],
    references: [department.id],
  }),
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
  departments: many(department),
  workAreas: many(workArea),
}));

export const siteLocationRelations = relations(siteLocation, ({ one, many }) => ({
  site: one(site, {
    fields: [siteLocation.siteId],
    references: [site.id],
  }),
  workAreas: many(workArea),
}));
