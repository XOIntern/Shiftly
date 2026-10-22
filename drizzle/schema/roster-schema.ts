import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { mpRequest } from "./mp-request-schema";
import { siteLocation } from "./site-schema";
import { shiftDefinition } from "./shift-schema";
import { worker } from "./worker-schema";
import { workArea } from "./work-area-schema";

// Roster plans (Cycle B, roster spec §3.2): one header per anchor — a
// weekly Monday-anchored plan or a single-day plan — with the assignments
// as DB rows. Uniqueness applies to the mutable DRAFT only via partial
// indexes; published versions keep every historical row (copy-on-edit
// bumps `version`). rules_snapshot freezes the resolved rule config at
// generation time so later config edits are not retroactive.

export const rosterPlanKindEnum = pgEnum("roster_plan_kind", [
  "weekly",
  "daily",
]);

export const rosterPlanStatusEnum = pgEnum("roster_plan_status", [
  "draft",
  "published",
]);

export const rosterPlan = pgTable(
  "roster_plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    kind: rosterPlanKindEnum("kind").notNull(),
    weekStart: date("week_start"),
    requestDate: date("request_date"),
    status: rosterPlanStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    rulesSnapshot: jsonb("rules_snapshot").notNull(),
    sourceRequestId: uuid("source_request_id"),
    // auth user.id is a text PK — the FK column type must match (text).
    generatedBy: text("generated_by"),
    publishedAt: timestamp("published_at"),
    publishedBy: text("published_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Same exactly-one-anchor shape as mp_request: weekly plans anchor on a
    // Monday, daily plans on exactly one date — never both anchors at once.
    check(
      "roster_plan_exactly_one_anchor",
      sql`(kind = 'weekly' and week_start is not null and request_date is null and extract(dow from week_start) = 1) or (kind = 'daily' and request_date is not null and week_start is null)`,
    ),
    // One live draft per location per week (publishing frees the slot).
    uniqueIndex("roster_plan_weekly_draft_unique")
      .on(table.siteLocationId, table.weekStart)
      .where(sql`kind = 'weekly' and status = 'draft'`),
    // One plan per location per date, any status — the daily history row
    // keeps holding the slot (no status filter, per spec §3.2).
    uniqueIndex("roster_plan_daily_unique")
      .on(table.siteLocationId, table.requestDate)
      .where(sql`kind = 'daily'`),
    // Weld: the plan's location must sit on the SAME site as the
    // denormalized site_id (cross-site insert → 23503).
    foreignKey({
      name: "roster_plan_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
    // A request consumed by a roster cannot be deleted — RESTRICT makes the
    // existing app-level rule structural.
    foreignKey({
      name: "roster_plan_source_request_fk",
      columns: [table.sourceRequestId],
      foreignColumns: [mpRequest.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "roster_plan_generated_by_user_fk",
      columns: [table.generatedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "roster_plan_published_by_user_fk",
      columns: [table.publishedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
  ],
);

// The plan's rows (roster spec §3.3): worker → shift on a date, all welds
// RESTRICT so nothing a plan references can be pulled out from under it.
export const rosterAssignment = pgTable(
  "roster_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    workerId: uuid("worker_id").notNull(),
    workAreaId: uuid("work_area_id").notNull(),
    shiftDefinitionId: uuid("shift_definition_id").notNull(),
    date: date("date").notNull(),
  },
  (table) => [
    // One shift per worker-day — the roster domain invariant.
    unique("roster_assignment_plan_worker_date_unique").on(
      table.planId,
      table.workerId,
      table.date,
    ),
    index("roster_assignment_plan_work_area_date_idx").on(
      table.planId,
      table.workAreaId,
      table.date,
    ),
    foreignKey({
      name: "roster_assignment_plan_fk",
      columns: [table.planId],
      foreignColumns: [rosterPlan.id],
    }).onDelete("cascade"),
    // Worker welds by (id, site_id) — the pair unique from the worker
    // migration; workers carry no site_location in their weld key.
    foreignKey({
      name: "roster_assignment_worker_site_fk",
      columns: [table.workerId, table.siteId],
      foreignColumns: [worker.id, worker.siteId],
    }).onDelete("restrict"),
    // Work area / shift definition triple-weld like mp_request_line: the
    // area/shift must live in the SAME location AND site as the plan
    // (cross-location pairing impossible even by direct insert → 23503).
    foreignKey({
      name: "roster_assignment_work_area_weld_fk",
      columns: [table.workAreaId, table.siteLocationId, table.siteId],
      foreignColumns: [workArea.id, workArea.siteLocationId, workArea.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "roster_assignment_shift_definition_weld_fk",
      columns: [table.shiftDefinitionId, table.siteLocationId, table.siteId],
      foreignColumns: [
        shiftDefinition.id,
        shiftDefinition.siteLocationId,
        shiftDefinition.siteId,
      ],
    }).onDelete("restrict"),
  ],
);

// Relations follow the one-way-import pattern of the other schema files
// (see work-area-schema.ts): roster-schema pulls in site/auth/mp-request/
// work-area/shift/worker and nothing pulls back in, so no evaluation
// cycles. The barrel re-exports everything.
export const rosterPlanRelations = relations(rosterPlan, ({ one, many }) => ({
  siteLocation: one(siteLocation, {
    fields: [rosterPlan.siteLocationId],
    references: [siteLocation.id],
  }),
  sourceRequest: one(mpRequest, {
    fields: [rosterPlan.sourceRequestId],
    references: [mpRequest.id],
  }),
  generatedByUser: one(user, {
    fields: [rosterPlan.generatedBy],
    references: [user.id],
  }),
  publishedByUser: one(user, {
    fields: [rosterPlan.publishedBy],
    references: [user.id],
  }),
  assignments: many(rosterAssignment),
}));

export const rosterAssignmentRelations = relations(
  rosterAssignment,
  ({ one }) => ({
    plan: one(rosterPlan, {
      fields: [rosterAssignment.planId],
      references: [rosterPlan.id],
    }),
    worker: one(worker, {
      fields: [rosterAssignment.workerId],
      references: [worker.id],
    }),
    workArea: one(workArea, {
      fields: [rosterAssignment.workAreaId],
      references: [workArea.id],
    }),
    shiftDefinition: one(shiftDefinition, {
      fields: [rosterAssignment.shiftDefinitionId],
      references: [shiftDefinition.id],
    }),
  }),
);
