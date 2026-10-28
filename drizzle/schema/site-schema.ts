import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { LocationTimezone } from "../../types/timezone";

export const site = pgTable(
  "site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    uniqueIndex("site_name_unique")
      .on(table.name)
      .where(sql`deleted_at is null`),
  ],
);

export const siteLocation = pgTable(
  "site_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // The location owns its time zone (sites span WIB, WITA and WIT): "today"
    // for attendance is decided from it on the server. Must stay in sync with
    // LOCATION_TIMEZONES (types/timezone.ts) and the CHECK below.
    timezone: text("timezone")
      .$type<LocationTimezone>()
      .notNull()
      .default("Asia/Jakarta"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    check(
      "site_location_timezone_check",
      sql`${table.timezone} in ('Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura')`,
    ),
    uniqueIndex("site_location_site_id_name_unique")
      .on(table.siteId, table.name)
      .where(sql`deleted_at is null`),
    // Plain (non-partial) unique CONSTRAINT on the parent pair so the
    // composite FK from work_area(site_location_id, site_id) resolves at
    // FK-creation time (see ./work-area-schema.ts comment).
    unique("site_location_id_site_id_unique").on(table.id, table.siteId),
  ],
);

// siteRelations / siteLocationRelations moved to ./work-area-schema (GitHub
// #58): extending them with workAreas from here would create an import
// cycle with that file. The barrel re-exports them unchanged.
