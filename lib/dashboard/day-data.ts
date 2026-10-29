import { and, asc, eq, inArray } from "drizzle-orm";

import {
  attendanceRecord,
  rosterAssignment,
  rosterPlan,
} from "@/drizzle/schema";
import { mergeRosterRows } from "@/lib/attendance-data";
import { buildDayRows, summarizeDayRows } from "@/lib/attendance-day";
import { db } from "@/lib/db";
import { mondayOf } from "@/lib/dates";
import type { RecordInput, RosterRowInput } from "@/types/attendance";

// The roster and the attendance of many (location, date) pairs in a fixed
// number of queries, following the attendance page's rules (lib/attendance-data)
// so a dashboard number equals the page's number. The callers pass location
// ids that are already scoped to the actor.

export type LocationDay = { locationId: string; date: string };

export const dayKey = (locationId: string, date: string): string =>
  `${locationId}|${date}`;

export type DayInput = { roster: RosterRowInput[]; records: RecordInput[] };

// `${siteLocationId}|${weekStart}` -> id of the highest version: a revised week
// republishes at a higher version and only the newest rows are operative.
export function pickLatestPlans(
  plans: {
    id: string;
    siteLocationId: string;
    weekStart: string;
    version: number;
  }[],
): Map<string, string> {
  const best = new Map<string, { id: string; version: number }>();
  for (const plan of plans) {
    const key = `${plan.siteLocationId}|${plan.weekStart}`;
    const seen = best.get(key);
    if (!seen || plan.version > seen.version) {
      best.set(key, { id: plan.id, version: plan.version });
    }
  }
  return new Map([...best].map(([key, { id }]) => [key, id]));
}

// Four queries however many days are asked for (none when none are): the
// published weekly plans of the Mondays involved, then their rows; the daily
// rows; the records. Each query covers the cross product of the requested
// locations and dates and the rows are matched back to the exact requested
// pairs in memory, so no pair loads another's rows.
export async function loadDayInputs(
  days: LocationDay[],
): Promise<Map<string, DayInput>> {
  const inputs = new Map<string, DayInput>();
  for (const { locationId, date } of days) {
    inputs.set(dayKey(locationId, date), { roster: [], records: [] });
  }
  if (inputs.size === 0) return inputs;

  const locationIds = [...new Set(days.map((day) => day.locationId))];
  const dates = [...new Set(days.map((day) => day.date))];
  const mondays = [...new Set(dates.map(mondayOf))];

  const [weeklyByDay, dailyRows, recordRows] = await Promise.all([
    loadWeeklyRows(locationIds, dates, mondays),
    db
      .select({
        locationId: rosterPlan.siteLocationId,
        date: rosterAssignment.date,
        workerId: rosterAssignment.workerId,
        workAreaId: rosterAssignment.workAreaId,
        shiftDefId: rosterAssignment.shiftDefinitionId,
      })
      .from(rosterAssignment)
      .innerJoin(rosterPlan, eq(rosterAssignment.planId, rosterPlan.id))
      .where(
        and(
          inArray(rosterPlan.siteLocationId, locationIds),
          eq(rosterPlan.kind, "daily"),
          inArray(rosterAssignment.date, dates),
        ),
      )
      .orderBy(asc(rosterAssignment.workerId)),
    db
      .select()
      .from(attendanceRecord)
      .where(
        and(
          inArray(attendanceRecord.siteLocationId, locationIds),
          inArray(attendanceRecord.date, dates),
        ),
      )
      .orderBy(asc(attendanceRecord.workerId)),
  ]);

  const dailyByDay = new Map<string, RosterRowInput[]>();
  for (const { locationId, date, ...row } of dailyRows) {
    const key = dayKey(locationId, date);
    if (!inputs.has(key)) continue;
    const rows = dailyByDay.get(key);
    if (rows) rows.push(row);
    else dailyByDay.set(key, [row]);
  }

  for (const [key, input] of inputs) {
    input.roster = mergeRosterRows(
      weeklyByDay.get(key) ?? [],
      dailyByDay.get(key) ?? [],
    );
  }

  for (const row of recordRows) {
    const input = inputs.get(dayKey(row.siteLocationId, row.date));
    if (!input) continue;
    input.records.push({
      id: row.id,
      workerId: row.workerId,
      shiftDefId: row.shiftDefinitionId,
      workAreaId: row.workAreaId,
      status: row.status,
      withoutRoster: row.withoutRoster,
      rosteredShiftDefId: row.rosteredShiftDefinitionId,
      reason: row.reason,
    });
  }

  return inputs;
}

// The rows dated one of `dates` of the latest published weekly plan of each
// location and week, keyed by day. Draft plans are not a roster yet. Rows of a
// day nobody asked for (a location's other requested date) are never read back
// because the caller looks entries up by the requested keys.
async function loadWeeklyRows(
  locationIds: string[],
  dates: string[],
  mondays: string[],
): Promise<Map<string, RosterRowInput[]>> {
  const byDay = new Map<string, RosterRowInput[]>();

  const plans = await db
    .select({
      id: rosterPlan.id,
      siteLocationId: rosterPlan.siteLocationId,
      weekStart: rosterPlan.weekStart,
      version: rosterPlan.version,
    })
    .from(rosterPlan)
    .where(
      and(
        inArray(rosterPlan.siteLocationId, locationIds),
        eq(rosterPlan.kind, "weekly"),
        eq(rosterPlan.status, "published"),
        inArray(rosterPlan.weekStart, mondays),
      ),
    );
  const latest = pickLatestPlans(
    plans.flatMap(({ weekStart, ...plan }) =>
      weekStart === null ? [] : [{ ...plan, weekStart }],
    ),
  );
  if (latest.size === 0) return byDay;
  const planLocation = new Map(
    plans.map((plan) => [plan.id, plan.siteLocationId]),
  );

  const rows = await db
    .select({
      planId: rosterAssignment.planId,
      date: rosterAssignment.date,
      workerId: rosterAssignment.workerId,
      workAreaId: rosterAssignment.workAreaId,
      shiftDefId: rosterAssignment.shiftDefinitionId,
    })
    .from(rosterAssignment)
    .where(
      and(
        inArray(rosterAssignment.planId, [...latest.values()]),
        inArray(rosterAssignment.date, dates),
      ),
    )
    .orderBy(asc(rosterAssignment.workerId));
  for (const { planId, date, ...row } of rows) {
    // The plan's location, as for the daily rows and the attendance page.
    const locationId = planLocation.get(planId);
    if (locationId === undefined) continue;
    const key = dayKey(locationId, date);
    const grouped = byDay.get(key);
    if (grouped) grouped.push(row);
    else byDay.set(key, [row]);
  }
  return byDay;
}

export type DaySummary = {
  scheduled: number;
  presentScheduled: number;
  present: number;
  leave: number;
  sick: number;
  absent: number;
  unrecorded: number;
  unscheduled: number;
};

export function deriveDay(input: DayInput): DaySummary {
  const rows = buildDayRows(input.roster, input.records);
  const scheduled = rows.filter((row) => row.state !== "unscheduled");
  return {
    ...summarizeDayRows(rows),
    scheduled: scheduled.length,
    presentScheduled: scheduled.filter((row) => row.record?.status === "present")
      .length,
    unscheduled: rows.length - scheduled.length,
  };
}

// How many of the days still have unrecorded rows, and the earliest of them.
export function deriveAttendanceBacklog(
  days: { date: string; unrecorded: number }[],
): { count: number; oldest: string | null } {
  const open = days.filter((day) => day.unrecorded > 0);
  const oldest = open.reduce<string | null>(
    (min, day) => (min === null || day.date < min ? day.date : min),
    null,
  );
  return { count: open.length, oldest };
}
