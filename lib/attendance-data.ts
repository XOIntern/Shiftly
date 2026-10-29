import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import {
  attendanceRecord,
  rosterAssignment,
  shiftDefinition,
  siteLocation,
  worker,
  workArea,
} from "../drizzle/schema";
import type {
  AreaOption,
  CandidateWorker,
  DayData,
  RecordInput,
  RosterRowInput,
  ShiftOption,
} from "../types/attendance";
import type { LocationTimezone } from "../types/timezone";
import { db } from "./db";
import type { DbExecutor } from "./db";
import { mondayOf } from "./week";
import {
  latestPublishedWeeklyPlan,
  loadDailyAssignmentsInRange,
} from "./roster-data";

// Read side of attendance: the roster rows of one date and everything the day
// page renders around them. Every loader is location-pinned; the caller has
// already scoped the location id to the actor (lib/attendance-scope).

// The rows dated `date` of the latest published weekly plan: a revised week
// republishes at a higher version and only the newest rows are operative
// (the same pick the roster actions use). Draft plans are not a roster yet.
async function loadWeeklyRows(
  siteLocationId: string,
  date: string,
  executor: DbExecutor,
): Promise<RosterRowInput[]> {
  const plan = await latestPublishedWeeklyPlan(
    siteLocationId,
    mondayOf(date),
    executor,
  );
  if (!plan) return [];
  return executor
    .select({
      workerId: rosterAssignment.workerId,
      workAreaId: rosterAssignment.workAreaId,
      shiftDefId: rosterAssignment.shiftDefinitionId,
    })
    .from(rosterAssignment)
    .where(
      and(
        eq(rosterAssignment.planId, plan.id),
        eq(rosterAssignment.date, date),
      ),
    )
    .orderBy(asc(rosterAssignment.workerId));
}

// The daily plan of the date, whatever its status: a daily fill stays `draft`
// and takes effect once it is filled, on top of the published week.
async function loadDailyRows(
  siteLocationId: string,
  date: string,
  executor: DbExecutor,
): Promise<RosterRowInput[]> {
  const rows = await loadDailyAssignmentsInRange(
    siteLocationId,
    date,
    date,
    executor,
  );
  return rows.map(({ workerId, workAreaId, shiftDefId }) => ({
    workerId,
    workAreaId,
    shiftDefId,
  }));
}

// Weekly rows first; a worker already present from the weekly plan is not
// repeated from the daily plan.
export function mergeRosterRows(
  weekly: RosterRowInput[],
  daily: RosterRowInput[],
): RosterRowInput[] {
  const seen = new Set(weekly.map((row) => row.workerId));
  return [...weekly, ...daily.filter((row) => !seen.has(row.workerId))];
}

export async function loadRosterRowsForDate(
  siteLocationId: string,
  date: string,
  executor: DbExecutor = db,
): Promise<RosterRowInput[]> {
  const [weekly, daily] = await Promise.all([
    loadWeeklyRows(siteLocationId, date, executor),
    loadDailyRows(siteLocationId, date, executor),
  ]);
  return mergeRosterRows(weekly, daily);
}

// One load for the whole day page. Shifts, areas and workers are read
// regardless of deleted_at so a recorded row keeps its labels; only what is
// live and active is selectable. The workers map is one query over the ids
// the roster and the records name.
export async function loadDayData(
  siteLocationId: string,
  date: string,
): Promise<DayData> {
  const [weekly, daily, recordRows, shiftRows, areaRows, candidateRows, [loc]] =
    await Promise.all([
      loadWeeklyRows(siteLocationId, date, db),
      loadDailyRows(siteLocationId, date, db),
      db
        .select()
        .from(attendanceRecord)
        .where(
          and(
            eq(attendanceRecord.siteLocationId, siteLocationId),
            eq(attendanceRecord.date, date),
          ),
        )
        .orderBy(asc(attendanceRecord.workerId)),
      db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.siteLocationId, siteLocationId))
        .orderBy(asc(shiftDefinition.orderIndex)),
      db
        .select()
        .from(workArea)
        .where(eq(workArea.siteLocationId, siteLocationId))
        .orderBy(asc(workArea.name)),
      db
        .select({
          id: worker.id,
          employeeId: worker.employeeId,
          name: worker.name,
        })
        .from(worker)
        .where(
          and(
            eq(worker.siteLocationId, siteLocationId),
            isNull(worker.deletedAt),
            eq(worker.isActive, true),
          ),
        )
        .orderBy(asc(worker.employeeId)),
      db
        .select({ timezone: siteLocation.timezone })
        .from(siteLocation)
        .where(eq(siteLocation.id, siteLocationId))
        .limit(1),
    ]);

  const roster = mergeRosterRows(weekly, daily);
  const records: RecordInput[] = recordRows.map((row) => ({
    id: row.id,
    workerId: row.workerId,
    shiftDefId: row.shiftDefinitionId,
    workAreaId: row.workAreaId,
    status: row.status,
    withoutRoster: row.withoutRoster,
    rosteredShiftDefId: row.rosteredShiftDefinitionId,
    reason: row.reason,
  }));

  const ids = [
    ...new Set([
      ...roster.map((row) => row.workerId),
      ...records.map((row) => row.workerId),
    ]),
  ];
  const workers: DayData["workers"] = {};
  if (ids.length > 0) {
    const rows = await db
      .select({
        id: worker.id,
        employeeId: worker.employeeId,
        name: worker.name,
      })
      .from(worker)
      .where(inArray(worker.id, ids));
    for (const row of rows) {
      workers[row.id] = { employeeId: row.employeeId, name: row.name };
    }
  }

  const shifts: ShiftOption[] = shiftRows.map((row) => ({
    id: row.id,
    label: row.label,
    startTime: row.startTime,
    endTime: row.endTime,
    selectable: row.isActive && row.deletedAt === null,
  }));
  const areas: AreaOption[] = areaRows.map((row) => ({
    id: row.id,
    name: row.name,
    selectable: row.isActive && row.deletedAt === null,
  }));
  const candidates: CandidateWorker[] = candidateRows;

  // A location that vanished between the page's scope check and this read
  // falls back to the column default rather than crashing the page.
  const timezone: LocationTimezone = loc?.timezone ?? "Asia/Jakarta";

  return { roster, records, workers, shifts, areas, candidates, timezone };
}
