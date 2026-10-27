import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { siteLocation } from "./site-schema";
import { user } from "./auth-schema";
import { workArea, workAreaPosition } from "./work-area-schema";
import { position } from "./position-schema";
import { shiftDefinition } from "./shift-schema";

// MP requests (Module 3, mp-requests epic): the admin-facing demand channel
// — one weekly (Monday-anchored) or daily requirement per site_location,
// filled with per-work-area/per-shift/per-position headcount lines. Two
// slot-holding statuses (open, approved) would collide on the same anchor
// (partial uniques);
// rejected/fulfilled frees the slot and history stays as new rows. There
// is no soft delete: rejection is the void path.
export const mpRequestTypeEnum = pgEnum("mp_request_type", [
  "weekly",
  "daily",
]);

export const mpRequestStatusEnum = pgEnum("mp_request_status", [
  "open",
  "approved",
  "fulfilled",
  "rejected",
]);

// The statuses that hold the anchor slot; mirrored in the partial uniques.
const SLOT_STATUSES = sql`('open','approved')`;

export const mpRequest = pgTable(
  "mp_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    type: mpRequestTypeEnum("type").notNull(),
    status: mpRequestStatusEnum("status").notNull().default("open"),
    weekStart: date("week_start"),
    requestDate: date("request_date"),
    // auth user.id is a text PK — the FK column type must match (text).
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Weekly requests anchor on a Monday, daily on exactly one date — and
    // never both anchors at once (spec §4.2).
    check(
      "mp_request_exactly_one_anchor",
      sql`(type = 'weekly' and week_start is not null and request_date is null and extract(dow from week_start) = 1) or (type = 'daily' and request_date is not null and week_start is null)`,
    ),
    // One open request per location per week / per date. Two indexes so the
    // weekly and daily slots are independent.
    uniqueIndex("mp_request_weekly_open_unique")
      .on(table.siteLocationId, table.weekStart)
      .where(
        sql`type = 'weekly' and status in ${SLOT_STATUSES}`,
      ),
    uniqueIndex("mp_request_daily_open_unique")
      .on(table.siteLocationId, table.requestDate)
      .where(
        sql`type = 'daily' and status in ${SLOT_STATUSES}`,
      ),
    // Weld: the request's location must sit on the SAME site as the
    // denormalized site_id (cross-site insert → 23503).
    foreignKey({
      name: "mp_request_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "mp_request_created_by_user_fk",
      columns: [table.createdBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
  ],
);

export const mpRequestLine = pgTable(
  "mp_request_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    workAreaId: uuid("work_area_id").notNull(),
    shiftDefinitionId: uuid("shift_definition_id").notNull(),
    positionId: uuid("position_id").notNull(),
    date: date("date").notNull(),
    headcount: integer("headcount").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // The line's work area / shift must live in the SAME location AND site
    // as the request — the parents expose matching composite uniques
    // (work_area_id_site_location_id_site_id_unique,
    // shift_definition_id_site_location_id_site_id_unique), so even a
    // direct insert cannot pair across locations or sites (23503).
    check(
      "mp_request_line_headcount_range",
      sql`headcount between 1 and 999`,
    ),
    unique("mp_request_line_request_work_area_shift_position_date_unique").on(
      table.requestId,
      table.workAreaId,
      table.shiftDefinitionId,
      table.positionId,
      table.date,
    ),
    index("mp_request_line_request_id_idx").on(table.requestId),
    foreignKey({
      name: "mp_request_line_request_fk",
      columns: [table.requestId],
      foreignColumns: [mpRequest.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "mp_request_line_work_area_weld_fk",
      columns: [table.workAreaId, table.siteLocationId, table.siteId],
      foreignColumns: [workArea.id, workArea.siteLocationId, workArea.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "mp_request_line_shift_definition_weld_fk",
      columns: [table.shiftDefinitionId, table.siteLocationId, table.siteId],
      foreignColumns: [
        shiftDefinition.id,
        shiftDefinition.siteLocationId,
        shiftDefinition.siteId,
      ],
    }).onDelete("restrict"),
    // The demanded position must be a position of the SAME site and one of
    // the work area's required positions — both welds resolve against the
    // composite uniques/PK (position_id_site_id_unique, the work_area_position
    // PK), so even a direct SQL insert cannot pair an off-set or cross-site
    // position (23503). Removing a pivot row still referenced by a line is
    // blocked (23503) with a readable action error.
    foreignKey({
      name: "mp_request_line_position_site_fk",
      columns: [table.positionId, table.siteId],
      foreignColumns: [position.id, position.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "mp_request_line_work_area_position_weld_fk",
      columns: [table.workAreaId, table.positionId],
      foreignColumns: [
        workAreaPosition.workAreaId,
        workAreaPosition.positionId,
      ],
    }).onDelete("restrict"),
  ],
);

// Relations live here rather than back in site-schema.ts (one-way deps, no
// evaluation cycles — see shift-schema.ts). Request → user resolves by id
// only; no relation back from user keeps auth-schema free of module 3.
export const mpRequestRelations = relations(mpRequest, ({ one, many }) => ({
  siteLocation: one(siteLocation, {
    fields: [mpRequest.siteLocationId],
    references: [siteLocation.id],
  }),
  createdBy: one(user, {
    fields: [mpRequest.createdBy],
    references: [user.id],
  }),
  lines: many(mpRequestLine),
}));

export const mpRequestLineRelations = relations(mpRequestLine, ({ one }) => ({
  request: one(mpRequest, {
    fields: [mpRequestLine.requestId],
    references: [mpRequest.id],
  }),
  workArea: one(workArea, {
    fields: [mpRequestLine.workAreaId],
    references: [workArea.id],
  }),
  shiftDefinition: one(shiftDefinition, {
    fields: [mpRequestLine.shiftDefinitionId],
    references: [shiftDefinition.id],
  }),
  position: one(position, {
    fields: [mpRequestLine.positionId],
    references: [position.id],
  }),
}));
