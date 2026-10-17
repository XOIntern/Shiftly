import { relations, sql } from "drizzle-orm";
import {
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    uniqueIndex("site_location_site_id_name_unique")
      .on(table.siteId, table.name)
      .where(sql`deleted_at is null`),
  ],
);

export const siteRelations = relations(site, ({ many }) => ({
  locations: many(siteLocation),
}));

export const siteLocationRelations = relations(siteLocation, ({ one }) => ({
  site: one(site, {
    fields: [siteLocation.siteId],
    references: [site.id],
  }),
}));
