import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";
import { siteLocation } from "./site-schema";
import { shiftDefinition } from "./shift-schema";
import { worker } from "./worker-schema";
import { workArea } from "./work-area-schema";

// Daily per-shift attendance: the record of who actually worked which shift,
// and the basis of salary estimation. Rows are lazy — one exists only once an
// Admin has recorded it; the day list is the roster LEFT JOINed to this table,
// so the roster never writes here and the dependency stays Roster ->
// Attendance. `date` is the plain local work date of the location (see
// site_location.timezone), so no stored value is ever converted.
//
// No soft delete: attendance is payroll basis and is never hidden. Every FK
// is RESTRICT, so nothing a record references can be deleted from under it.

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "leave",
  "sick",
  "absent",
]);

export const attendanceRecord = pgTable(
  "attendance_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteLocationId: uuid("site_location_id").notNull(),
    siteId: uuid("site_id").notNull(),
    workerId: uuid("worker_id").notNull(),
    date: date("date").notNull(),
    // The shift actually worked; the rostered shift is kept beside it so a
    // swap on the roster row stays visible.
    shiftDefinitionId: uuid("shift_definition_id").notNull(),
    workAreaId: uuid("work_area_id").notNull(),
    status: attendanceStatusEnum("status").notNull(),
    // A worker who was not on the roster that day, added with a reason.
    withoutRoster: boolean("without_roster").notNull().default(false),
    rosteredShiftDefinitionId: uuid("rostered_shift_definition_id"),
    reason: text("reason"),
    // auth user.id is a text PK — the FK column type must match (text).
    recordedBy: text("recorded_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // One record per worker per day: the invariant lazy rows rely on, and the
    // conflict target that tells a double recording from a first one.
    unique("attendance_record_worker_date_unique").on(
      table.workerId,
      table.date,
    ),
    // Unscheduled rows carry no rostered shift; every other row does.
    check(
      "attendance_record_without_roster_check",
      sql`without_roster = (rostered_shift_definition_id is null)`,
    ),
    index("attendance_record_location_date_idx").on(
      table.siteLocationId,
      table.date,
    ),
    // Weld: the record's location must sit on the SAME site as the
    // denormalized site_id (cross-site insert -> 23503).
    foreignKey({
      name: "attendance_record_site_location_site_fk",
      columns: [table.siteLocationId, table.siteId],
      foreignColumns: [siteLocation.id, siteLocation.siteId],
    }).onDelete("restrict"),
    // Worker welds by (id, site_id), like roster_assignment.
    foreignKey({
      name: "attendance_record_worker_site_fk",
      columns: [table.workerId, table.siteId],
      foreignColumns: [worker.id, worker.siteId],
    }).onDelete("restrict"),
    // Shift and work area triple-weld: they must live in the SAME location
    // and site as the record, even by direct insert.
    foreignKey({
      name: "attendance_record_shift_definition_weld_fk",
      columns: [table.shiftDefinitionId, table.siteLocationId, table.siteId],
      foreignColumns: [
        shiftDefinition.id,
        shiftDefinition.siteLocationId,
        shiftDefinition.siteId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "attendance_record_rostered_shift_weld_fk",
      columns: [
        table.rosteredShiftDefinitionId,
        table.siteLocationId,
        table.siteId,
      ],
      foreignColumns: [
        shiftDefinition.id,
        shiftDefinition.siteLocationId,
        shiftDefinition.siteId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "attendance_record_work_area_weld_fk",
      columns: [table.workAreaId, table.siteLocationId, table.siteId],
      foreignColumns: [workArea.id, workArea.siteLocationId, workArea.siteId],
    }).onDelete("restrict"),
    foreignKey({
      name: "attendance_record_recorded_by_user_fk",
      columns: [table.recordedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
  ],
);

// One-way imports like roster-schema.ts: attendance pulls in site/auth/
// shift/worker/work-area and nothing pulls back in, so no evaluation cycles.
export const attendanceRecordRelations = relations(
  attendanceRecord,
  ({ one }) => ({
    siteLocation: one(siteLocation, {
      fields: [attendanceRecord.siteLocationId],
      references: [siteLocation.id],
    }),
    worker: one(worker, {
      fields: [attendanceRecord.workerId],
      references: [worker.id],
    }),
    shiftDefinition: one(shiftDefinition, {
      fields: [attendanceRecord.shiftDefinitionId],
      references: [shiftDefinition.id],
      relationName: "attendance_worked_shift",
    }),
    rosteredShiftDefinition: one(shiftDefinition, {
      fields: [attendanceRecord.rosteredShiftDefinitionId],
      references: [shiftDefinition.id],
      relationName: "attendance_rostered_shift",
    }),
    workArea: one(workArea, {
      fields: [attendanceRecord.workAreaId],
      references: [workArea.id],
    }),
    recordedByUser: one(user, {
      fields: [attendanceRecord.recordedBy],
      references: [user.id],
    }),
  }),
);
