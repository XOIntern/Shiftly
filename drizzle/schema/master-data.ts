import { relations } from "drizzle-orm";
import {
  boolean,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const client = pgTable("client", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const site = pgTable(
  "site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    location: text("location").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [unique("site_client_id_name_unique").on(table.clientId, table.name)],
);

export const siteLocation = pgTable(
  "site_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [unique("site_location_site_id_name_unique").on(table.siteId, table.name)],
);

export const clientRelations = relations(client, ({ many }) => ({
  sites: many(site),
}));

export const siteRelations = relations(site, ({ one, many }) => ({
  client: one(client, {
    fields: [site.clientId],
    references: [client.id],
  }),
  locations: many(siteLocation),
}));

export const siteLocationRelations = relations(siteLocation, ({ one }) => ({
  site: one(site, {
    fields: [siteLocation.siteId],
    references: [site.id],
  }),
}));
