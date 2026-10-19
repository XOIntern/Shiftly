import { relations, sql } from "drizzle-orm";
import {
  boolean,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { site } from "./site-schema";

// Positions (jabatan) are a per-site catalog: a site defines its own
// position names (unique among live rows per site), and workers — once the
// worker table exists — will reference a position of their own site. The
// site FK is ON DELETE RESTRICT so a site with positions cannot be
// hard-deleted behind the app-level guards.
export const position = pgTable(
  "position",
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
    uniqueIndex("position_site_id_name_unique")
      .on(table.siteId, table.name)
      .where(sql`deleted_at is null`),
    // Plain (non-partial) unique CONSTRAINT on the parent pair so the
    // composite FK from worker(position_id, site_id) resolves at
    // FK-creation time (see ./worker-schema.ts comment).
    unique("position_id_site_id_unique").on(table.id, table.siteId),
  ],
);

// Relations live here rather than extending siteRelations in
// work-area-schema: same one-way dependency pattern
// (position-schema → site-schema), no evaluation cycle. The barrel
// re-exports everything, and no consumer imports the relations symbols
// directly.
export const positionRelations = relations(position, ({ one }) => ({
  site: one(site, {
    fields: [position.siteId],
    references: [site.id],
  }),
}));
