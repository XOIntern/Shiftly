import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";

import { db } from "./db";
import {
  mpRequest,
  mpRequestLine,
  rosterAssignment,
  rosterPlan,
  shiftDefinition,
  worker,
  workerPosition,
  workArea,
  workAreaPosition,
} from "../drizzle/schema";
import type { GeneratorWorker, RequirementLine } from "./engine/generate";
import type { RosterAssignment } from "@/types/engine";

// Data loaders between the roster schema and the pure engine (roster-engine
// task 5). Every loader is site_location-pinned, so the actions can derive
// scoping server-side and hand the location id down. Dates stay "YYYY-MM-DD"
// strings; shift ids are ordered by `orderIndex`; the engine receives
// capability-derived worker pairs (one GeneratorWorker per eligible
// worker×area pair) plus a unioned per-worker profile record.

// Live + active shift ids of the location, by order_index ascending.
export async function loadShiftOrder(siteLocationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: shiftDefinition.id })
    .from(shiftDefinition)
    .where(
      and(
        eq(shiftDefinition.siteLocationId, siteLocationId),
        isNull(shiftDefinition.deletedAt),
        eq(shiftDefinition.isActive, true),
      ),
    )
    .orderBy(asc(shiftDefinition.orderIndex));
  return rows.map((r) => r.id);
}

// Required positions per live work area of the location. Every live area is
// present as a key (empty array = C7 no-op for that area); soft-deleted
// areas hold nothing.
export async function loadAreaRequirements(
  siteLocationId: string,
): Promise<Record<string, string[]>> {
  const areaRows = await db
    .select({ id: workArea.id })
    .from(workArea)
    .where(and(eq(workArea.siteLocationId, siteLocationId), isNull(workArea.deletedAt)))
    .orderBy(asc(workArea.id));

  const posRows = await db
    .select({ workAreaId: workAreaPosition.workAreaId, positionId: workAreaPosition.positionId })
    .from(workAreaPosition)
    .innerJoin(workArea, eq(workAreaPosition.workAreaId, workArea.id))
    .where(and(eq(workAreaPosition.siteLocationId, siteLocationId), isNull(workArea.deletedAt)))
    .orderBy(asc(workAreaPosition.workAreaId), asc(workAreaPosition.positionId));

  const requirements: Record<string, string[]> = {};
  for (const row of areaRows) requirements[row.id] = [];
  for (const row of posRows) requirements[row.workAreaId]?.push(row.positionId);
  return requirements;
}

// C7 eligibility reused verbatim: non-empty requirement needs an
// intersection with the worker's positions; empty = everyone qualifies.
function eligibleFor(
  positionIds: readonly string[],
  requiredPositions: readonly string[],
): boolean {
  return (
    requiredPositions.length === 0 ||
    requiredPositions.some((p) => positionIds.includes(p))
  );
}

// Worker pairs for the generator pools: one GeneratorWorker per (live,
// active worker, live area of the location) pair where the worker is C7-
// eligible for that area. The optional workAreaId narrows output to that
// area's pairs only. Order: employeeId → worker id → area id (stable engine
// input; the engine re-ranks by its own sortKey).
export async function loadWorkerProfiles(
  siteLocationId: string,
  workAreaId?: string,
): Promise<GeneratorWorker[]> {
  const workerRows = await db
    .select({ id: worker.id, employeeId: worker.employeeId })
    .from(worker)
    .where(
      and(
        eq(worker.siteLocationId, siteLocationId),
        isNull(worker.deletedAt),
        eq(worker.isActive, true),
      ),
    );

  const posRows = await db
    .select({ workerId: workerPosition.workerId, positionId: workerPosition.positionId })
    .from(workerPosition)
    .innerJoin(worker, eq(workerPosition.workerId, worker.id))
    .where(
      and(
        eq(worker.siteLocationId, siteLocationId),
        isNull(worker.deletedAt),
        eq(worker.isActive, true),
      ),
    )
    .orderBy(asc(workerPosition.positionId));

  const positionsByWorker = new Map<string, string[]>();
  for (const row of workerRows) positionsByWorker.set(row.id, []);
  for (const row of posRows) positionsByWorker.get(row.workerId)?.push(row.positionId);

  const areaRequirements = await loadAreaRequirements(siteLocationId);
  const areaIds = workAreaId
    ? areaRequirements[workAreaId] !== undefined
      ? [workAreaId]
      : []
    : Object.keys(areaRequirements);

  const workers: GeneratorWorker[] = [];
  for (const area of areaIds) {
    const required = areaRequirements[area];
    for (const row of workerRows) {
      const positionIds = positionsByWorker.get(row.id) ?? [];
      if (!eligibleFor(positionIds, required)) continue;
      workers.push({ ...row, workAreaId: area, positionIds });
    }
  }
  return workers;
}

// Requirement lines for one Monday-anchored week: lines of the WEEKLY
// request whose week_start equals the anchor exactly, in received or
// processing status (submitted is not confirmed demand, fulfilled is done).
// One open weekly request per location per week by the partial unique, so
// no aggregation two worlds can collide.
export async function loadRequirementsForWeek(
  siteLocationId: string,
  weekStart: string,
): Promise<RequirementLine[]> {
  const rows = await db
    .select({
      workAreaId: mpRequestLine.workAreaId,
      shiftDefId: mpRequestLine.shiftDefinitionId,
      date: mpRequestLine.date,
      headcount: mpRequestLine.headcount,
    })
    .from(mpRequestLine)
    .innerJoin(mpRequest, eq(mpRequestLine.requestId, mpRequest.id))
    .where(
      and(
        eq(mpRequest.siteLocationId, siteLocationId),
        eq(mpRequest.type, "weekly"),
        eq(mpRequest.weekStart, weekStart),
        inArray(mpRequest.status, ["received", "processing"]),
      ),
    )
    .orderBy(asc(mpRequestLine.date), asc(mpRequestLine.workAreaId), asc(mpRequestLine.shiftDefinitionId));
  return rows;
}

// Prior history for C1/C2/C5/C6: assignment rows of PUBLISHED plans of the
// location with date < beforeDate, in the engine shape. After a revise the
// old version stays published alongside the new one — only the LATEST
// published version per week enters history, or the same worker-day loads
// twice (kicking count-based rules over the line and deadlocking the
// generator's admission). Daily plans are already unique per date
// (roster_plan_daily_unique); weekly plans dedupe on (week_start, version).
export async function loadPriorAssignments(
  siteLocationId: string,
  beforeDate: string,
): Promise<RosterAssignment[]> {
  const rows = await db
    .select({
      workerId: rosterAssignment.workerId,
      date: rosterAssignment.date,
      shiftDefId: rosterAssignment.shiftDefinitionId,
      workAreaId: rosterAssignment.workAreaId,
      planId: rosterPlan.id,
      planKind: rosterPlan.kind,
      planWeekStart: rosterPlan.weekStart,
      planVersion: rosterPlan.version,
    })
    .from(rosterAssignment)
    .innerJoin(rosterPlan, eq(rosterAssignment.planId, rosterPlan.id))
    .where(
      and(
        eq(rosterPlan.siteLocationId, siteLocationId),
        eq(rosterPlan.status, "published"),
        lt(rosterAssignment.date, beforeDate),
      ),
    )
    .orderBy(asc(rosterAssignment.date), asc(rosterAssignment.workerId));

  const latestByWeek = new Map<string, { planId: string; version: number }>();
  for (const row of rows) {
    if (row.planKind !== "weekly" || row.planWeekStart === null) continue;
    const current = latestByWeek.get(row.planWeekStart);
    if (!current || row.planVersion > current.version) {
      latestByWeek.set(row.planWeekStart, {
        planId: row.planId,
        version: row.planVersion,
      });
    }
  }

  return rows
    .filter((row) => {
      if (row.planKind !== "weekly" || row.planWeekStart === null) return true;
      return latestByWeek.get(row.planWeekStart)?.planId === row.planId;
    })
    .map(({ workerId, date, shiftDefId, workAreaId }) => ({
      workerId,
      date,
      shiftDefId,
      workAreaId,
    }));
}

// The LATEST published weekly plan of one Monday-anchored week (a revised
// week republishes at a higher version; only the newest rows are the
// operative ones). Null when no published weekly plan covers the week.
// fillDailyRequest and suggestReplacementsAction share this pick so the two
// can never disagree about which plan's rows are operative.
export async function latestPublishedWeeklyPlan(
  siteLocationId: string,
  weekStart: string,
): Promise<typeof rosterPlan.$inferSelect | null> {
  const [plan] = await db
    .select()
    .from(rosterPlan)
    .where(
      and(
        eq(rosterPlan.siteLocationId, siteLocationId),
        eq(rosterPlan.kind, "weekly"),
        eq(rosterPlan.status, "published"),
        eq(rosterPlan.weekStart, weekStart),
      ),
    )
    .orderBy(desc(rosterPlan.version))
    .limit(1);
  return plan ?? null;
}

export interface RosterPlanBundle {
  plan: typeof rosterPlan.$inferSelect;
  assignments: RosterAssignment[];
  rows: {
    id: string;
    workerId: string;
    workAreaId: string;
    shiftDefinitionId: string;
    date: string;
  }[];
}

// Plan + its rows, for the editor and the publish gate. Null for a missing
// plan (presences are checked by the callers' scope guards).
export async function loadPlanWithRows(planId: string): Promise<RosterPlanBundle | null> {
  const [plan] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, planId)).limit(1);
  if (!plan) return null;

  const rows = await db
    .select({
      id: rosterAssignment.id,
      workerId: rosterAssignment.workerId,
      workAreaId: rosterAssignment.workAreaId,
      shiftDefinitionId: rosterAssignment.shiftDefinitionId,
      date: rosterAssignment.date,
    })
    .from(rosterAssignment)
    .where(eq(rosterAssignment.planId, planId))
    .orderBy(asc(rosterAssignment.date), asc(rosterAssignment.workerId));

  const assignments: RosterAssignment[] = rows.map((r) => ({
    workerId: r.workerId,
    date: r.date,
    shiftDefId: r.shiftDefinitionId,
    workAreaId: r.workAreaId,
  }));

  return { plan, assignments, rows };
}
