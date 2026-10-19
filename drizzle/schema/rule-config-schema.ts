import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { site, siteLocation } from "./site-schema";
import { user } from "./auth-schema";

// Rules C1–C7 (docs/architecture.md §5): max 5 work days/week, max 20/month,
// forward shift rotation 1→2→3, rest after shift 3, mandatory break,
// work area/qualification match. Config rows address them by these keys.
export const rosterRuleKeyEnum = pgEnum("roster_rule_key", [
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
]);

// One live row per (scope, rule key): unset site_id and site_location_id is
// the global base; per-site and per-location overrides narrow the scope. The
// CHECK welds every location-level row to its parent site, and the partial
// unique indexes follow the site-table pattern (WHERE deleted_at is null) so
// a soft-deleted row frees its scope for a replacement.
export const rosterRuleConfig = pgTable(
  "roster_rule_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleKey: rosterRuleKeyEnum("rule_key").notNull(),
    siteId: uuid("site_id").references(() => site.id, {
      onDelete: "restrict",
    }),
    siteLocationId: uuid("site_location_id").references(
      () => siteLocation.id,
      { onDelete: "restrict" },
    ),
    intValue: integer("int_value"),
    boolValue: boolean("bool_value"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    uniqueIndex("roster_rule_config_global_rule_key_unique")
      .on(table.ruleKey)
      .where(sql`site_id is null and site_location_id is null and deleted_at is null`),
    uniqueIndex("roster_rule_config_site_rule_key_unique")
      .on(table.siteId, table.ruleKey)
      .where(sql`site_id is not null and site_location_id is null and deleted_at is null`),
    uniqueIndex("roster_rule_config_site_location_rule_key_unique")
      .on(table.siteLocationId, table.ruleKey)
      .where(sql`site_location_id is not null and deleted_at is null`),
    check(
      "roster_rule_config_location_requires_site",
      sql`site_location_id is null or site_id is not null`,
    ),
  ],
);

export const rosterRuleConfigRelations = relations(rosterRuleConfig, ({ one }) => ({
  site: one(site, {
    fields: [rosterRuleConfig.siteId],
    references: [site.id],
  }),
  siteLocation: one(siteLocation, {
    fields: [rosterRuleConfig.siteLocationId],
    references: [siteLocation.id],
  }),
}));

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
  siteLocationId: uuid("site_location_id").references(
    () => siteLocation.id,
    { onDelete: "restrict" },
  ),
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
