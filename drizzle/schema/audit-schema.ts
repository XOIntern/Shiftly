import { relations } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { site, siteLocation } from "./site-schema";

// Append-only audit trail for sensitive decisions (publishes, config
// changes, attendance corrections, force majeure): no updated_at, no
// soft-delete — rows are written once and kept.
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Better Auth's user.id is text, so the actor reference must be text too.
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  siteId: uuid("site_id").references(() => site.id, {
    onDelete: "restrict",
  }),
  siteLocationId: uuid("site_location_id").references(() => siteLocation.id, {
    onDelete: "restrict",
  }),
  details: jsonb("details").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(user, {
    fields: [auditLog.actorId],
    references: [user.id],
  }),
  site: one(site, {
    fields: [auditLog.siteId],
    references: [site.id],
  }),
  siteLocation: one(siteLocation, {
    fields: [auditLog.siteLocationId],
    references: [siteLocation.id],
  }),
}));
