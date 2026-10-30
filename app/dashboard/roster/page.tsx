import { and, asc, countDistinct, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import {
  mpRequest,
  mpRequestLine,
  position,
  rosterAssignment,
  rosterPlan,
  shiftDefinition,
  site,
  siteLocation,
  worker,
  workArea,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { attendanceLocationWhere } from "@/lib/attendance-scope";
import { mpRequestListWhere } from "@/lib/mp-request-scope";
import { rosterPlanListWhere } from "@/lib/roster-scope";
import { mondayOf, weekDates } from "@/lib/week";
import {
  computeCoverage,
  coverageTotals,
  withoutFulfilledDailyFills,
} from "@/lib/engine/coverage";
import type { CoverageRequirement, CoverageRow } from "@/lib/engine/coverage";
import type { EffectiveRules, RosterAssignment } from "@/types/engine";
import {
  loadDailyRequirements,
  loadFulfilledDailyLines,
  loadPlanWithRows,
  loadRequirementsForWeek,
  loadWorkerProfiles,
} from "@/lib/roster-data";
import {
  planViolations,
  splitViolationsByHorizon,
} from "@/lib/roster-plan-mutations";
import { rosterGate } from "@/app/dashboard/roster/roster-gate";
import {
  pickPlan,
  selectedLocationFor,
} from "@/app/dashboard/roster/roster-location";
import { RosterWeekView } from "@/app/dashboard/roster/roster-week-view";
import type {
  GridPlanView,
  RosterPlanOption,
} from "@/app/dashboard/roster/roster-week-view";
import type { DailyFillView } from "@/app/dashboard/roster/daily-fills-list";
import type { SiteLocationOption, SiteOption } from "@/types/site";

// Deliberate block: the page queries roster data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Grid rows (workers of the selected work area) are sliced SERVER-SIDE:
// there is no unpaginated fetch anywhere on this page. The slice rides its
// own URL param (`rowPage`).
const ROWS_PER_PAGE = 50;

// Single-string URL params with a whitelist, Cycle A style
// (app/dashboard/requests/page.tsx): only well-formed values reach the
// queries, anything else parses to null (no filter).
function whitelistParam(
  raw: Record<string, string | string[] | undefined>,
  key: string,
  test: (value: string) => boolean,
): string | null {
  const value = raw[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single && test(single) ? single : null;
}

const isDateShape = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value);
const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isRowPage = (value: string): boolean => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && String(n) === value;
};

type Actor = Awaited<ReturnType<typeof requireUser>>;

export default async function RosterPage({
  searchParams,
}: PageProps<"/dashboard/roster">) {
  const actor = await requireUser();
  const raw = await searchParams;

  // The week anchor: a whitelisted `week` param snapped to its Monday, else
  // the running week (lib/week's mondayOf, the request-form precedent).
  const today = new Date().toISOString().slice(0, 10);
  const weekParam = whitelistParam(raw, "week", isDateShape);
  const week = mondayOf(weekParam ?? today);
  const planIdParam = whitelistParam(raw, "planId", isUuid);
  const locationParam = whitelistParam(raw, "locationId", isUuid);
  const workAreaParam = whitelistParam(raw, "workAreaId", isUuid);
  const rowPageParam = whitelistParam(raw, "rowPage", isRowPage);

  const canWrite = actor.role !== "ho";
  const dates = weekDates(week);

  // Locations in scope (name-ordered) and, for a superadmin, the sites that
  // prefix them in the picker.
  const [siteLocations, sites]: [SiteLocationOption[], SiteOption[]] =
    await Promise.all([
      db
        .select({
          id: siteLocation.id,
          name: siteLocation.name,
          siteId: siteLocation.siteId,
        })
        .from(siteLocation)
        .where(attendanceLocationWhere(actor))
        .orderBy(asc(siteLocation.name)),
      actor.role === "superadmin"
        ? db
            .select({ id: site.id, name: site.name })
            .from(site)
            .where(isNull(site.deletedAt))
            .orderBy(asc(site.name))
        : Promise.resolve([]),
    ]);

  // The week's weekly plans in scope, newest version first.
  const weekPlans = await db
    .select({
      id: rosterPlan.id,
      status: rosterPlan.status,
      version: rosterPlan.version,
      siteLocationId: rosterPlan.siteLocationId,
      locationName: siteLocation.name,
      siteName: site.name,
    })
    .from(rosterPlan)
    .innerJoin(siteLocation, eq(rosterPlan.siteLocationId, siteLocation.id))
    .innerJoin(site, eq(rosterPlan.siteId, site.id))
    .where(
      and(
        eq(rosterPlan.kind, "weekly"),
        eq(rosterPlan.weekStart, week),
        rosterPlanListWhere(actor),
      ),
    )
    .orderBy(desc(rosterPlan.version), asc(siteLocation.name));

  // One location for everything below: the admin's binding, else the URL
  // pick, else the plan the page would show, else the first by name.
  const locationId = selectedLocationFor({
    pinnedLocationId: actor.role === "admin" ? actor.siteLocationId : null,
    siteLocations,
    param: locationParam,
    planLocationId: pickPlan(weekPlans, planIdParam)?.siteLocationId,
  });
  const planRows = weekPlans.filter((p) => p.siteLocationId === locationId);
  const chosen = pickPlan(planRows, planIdParam);
  const bundle = chosen ? await loadPlanWithRows(chosen.id) : null;

  // Demand, coverage inputs and display masters of the resolved location.
  const [
    weeklyLines,
    dailyLines,
    dailyAssignments,
    fulfilledDailyLines,
    approved,
    areaRows,
    shiftRows,
  ] = locationId
    ? await Promise.all([
        loadRequirementsForWeek(locationId, week),
        loadDailyRequirements(locationId, dates[0], dates[dates.length - 1]),
        loadDailyAssignments(actor, locationId, dates),
        loadFulfilledDailyLines(locationId, dates[0], dates[dates.length - 1]),
        countApproved(actor, locationId, week),
        db
          .select({ id: workArea.id, name: workArea.name })
          .from(workArea)
          .where(
            and(
              eq(workArea.siteLocationId, locationId),
              isNull(workArea.deletedAt),
            ),
          )
          .orderBy(asc(workArea.name)),
        db
          .select({
            id: shiftDefinition.id,
            label: shiftDefinition.label,
            startTime: shiftDefinition.startTime,
            endTime: shiftDefinition.endTime,
            orderIndex: shiftDefinition.orderIndex,
            isActive: shiftDefinition.isActive,
          })
          .from(shiftDefinition)
          .where(
            and(
              eq(shiftDefinition.siteLocationId, locationId),
              isNull(shiftDefinition.deletedAt),
            ),
          )
          .orderBy(asc(shiftDefinition.orderIndex)),
      ])
    : [[], [], [], [], { requests: 0, headcount: 0 }, [], []];

  const requirements: CoverageRequirement[] = [
    ...weeklyLines.map((line) => ({ ...line, source: "weekly" as const })),
    ...dailyLines.map((line) => ({ ...line, source: "daily" as const })),
  ];
  const areaNames = Object.fromEntries(areaRows.map((a) => [a.id, a.name]));
  const shiftLabels = Object.fromEntries(shiftRows.map((s) => [s.id, s.label]));
  const shiftOrder = new Map(shiftRows.map((s) => [s.id, s.orderIndex]));
  const positionIds = [...new Set(requirements.map((r) => r.positionId))];
  const positionRows = positionIds.length
    ? await db
        .select({ id: position.id, name: position.name })
        .from(position)
        .where(inArray(position.id, positionIds))
    : [];

  // Panel order: weekly rows, then daily; by area name, shift order, date.
  const rows: CoverageRow[] = computeCoverage(
    requirements,
    bundle?.assignments ?? [],
    withoutFulfilledDailyFills(dailyAssignments, fulfilledDailyLines),
  ).sort(
    (a, b) =>
      Number(a.source === "daily") - Number(b.source === "daily") ||
      (areaNames[a.workAreaId] ?? "").localeCompare(areaNames[b.workAreaId] ?? "") ||
      (shiftOrder.get(a.shiftDefId) ?? 0) - (shiftOrder.get(b.shiftDefId) ?? 0) ||
      (a.date ?? "").localeCompare(b.date ?? ""),
  );

  // The plan's "filled" figure: weekly demand only. Daily slots are filled
  // after a weekly plan is published, so a draft could never cover them.
  const weeklyRows = rows.filter((r) => r.source === "weekly");

  // The selected work area: a URL pick of this location's areas, else the
  // first area with weekly demand, else the first area by name.
  const workAreaId =
    workAreaParam && areaRows.some((a) => a.id === workAreaParam)
      ? workAreaParam
      : (rows.find((r) => r.source === "weekly")?.workAreaId ??
        areaRows[0]?.id ??
        "");

  // The chosen plan's rule check: every violation is listed, only those
  // inside the plan's own week block publishing (history cannot change).
  const violations = bundle
    ? await planViolations(
        bundle.plan.siteLocationId,
        bundle.plan.rulesSnapshot as EffectiveRules,
        bundle.assignments,
        bundle.plan,
      )
    : [];
  const blockingViolationCount = bundle
    ? splitViolationsByHorizon(violations, bundle.plan).blocking.length
    : 0;

  const gate = rosterGate({
    canWrite,
    planStatus: chosen?.status ?? null,
    approvedRequestCount: approved.requests,
    // Headcount (people), the same unit the requirements panel shows.
    approvedSlotCount: approved.headcount,
    blockingViolationCount,
  });

  let planView: GridPlanView | null = null;
  if (chosen && bundle) {
    // Distinct eligible workers for the selected area, then the one slice.
    const distinct = new Map<string, { id: string; employeeId: string }>();
    for (const pair of workAreaId
      ? await loadWorkerProfiles(chosen.siteLocationId, workAreaId)
      : []) {
      if (!distinct.has(pair.id)) {
        distinct.set(pair.id, { id: pair.id, employeeId: pair.employeeId });
      }
    }
    const allWorkers = [...distinct.values()].sort(
      (a, b) =>
        a.employeeId.localeCompare(b.employeeId) || a.id.localeCompare(b.id),
    );
    const workerTotal = allWorkers.length;
    const pageCount = Math.max(1, Math.ceil(workerTotal / ROWS_PER_PAGE));
    const rowPage = Math.min(
      Number.parseInt(rowPageParam ?? "1", 10),
      pageCount,
    );
    const pageWorkers = allWorkers.slice(
      (rowPage - 1) * ROWS_PER_PAGE,
      rowPage * ROWS_PER_PAGE,
    );
    // Names only for the visible slice; the engine's worker pairs carry the
    // employee id alone.
    const nameRows = pageWorkers.length
      ? await db
          .select({ id: worker.id, name: worker.name })
          .from(worker)
          .where(
            inArray(
              worker.id,
              pageWorkers.map((w) => w.id),
            ),
          )
      : [];
    const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

    // This area's cells only: a worker holds at most one assignment per
    // day (the plan-level unique), and a row of ANOTHER area must not leak
    // into this card.
    const cells: Record<string, string> = {};
    for (const row of bundle.rows) {
      if (row.workAreaId !== workAreaId) continue;
      cells[`${row.workerId}|${row.date}`] = row.shiftDefinitionId;
    }
    // Daily fills of this area, read-only in the grid: a weekly cell of the
    // same worker-day always wins.
    const dailyCells: Record<string, string> = {};
    for (const row of dailyAssignments) {
      if (row.workAreaId !== workAreaId) continue;
      const key = `${row.workerId}|${row.date}`;
      if (key in cells) continue;
      dailyCells[key] = row.shiftDefId;
    }

    planView = {
      id: chosen.id,
      status: chosen.status,
      version: chosen.version,
      canEdit: canWrite && chosen.status === "draft",
      readOnlyReason: canWrite
        ? "Published — locked; revise to open the next draft."
        : "Read-only — rosters are managed by admins.",
      shifts: shiftRows
        .filter((s) => s.isActive)
        .map(({ id, label, startTime, endTime }) => ({
          id,
          label,
          startTime,
          endTime,
        })),
      workers: pageWorkers.map((w) => ({
        ...w,
        name: nameById.get(w.id) ?? "",
      })),
      workerTotal,
      rowPage,
      dates,
      cells,
      dailyCells,
    };
  }

  // Without a weekly plan there is no grid to carry the daily fills, so the
  // page lists them (read-only) where the grid would be.
  let dailyFills: DailyFillView[] = [];
  if (!planView && dailyAssignments.length > 0) {
    const fillWorkers = await db
      .select({ id: worker.id, employeeId: worker.employeeId, name: worker.name })
      .from(worker)
      .where(inArray(worker.id, [...new Set(dailyAssignments.map((a) => a.workerId))]));
    const workerById = new Map(fillWorkers.map((w) => [w.id, w]));
    dailyFills = dailyAssignments
      .map((a) => ({
        shiftIndex: shiftOrder.get(a.shiftDefId) ?? 0,
        fill: {
          date: a.date,
          workAreaName: areaNames[a.workAreaId] ?? "Work area",
          shiftLabel: shiftLabels[a.shiftDefId] ?? "Shift",
          employeeId: workerById.get(a.workerId)?.employeeId ?? "",
          name: workerById.get(a.workerId)?.name ?? "",
        },
      }))
      .sort(
        (a, b) =>
          a.fill.date.localeCompare(b.fill.date) ||
          a.fill.workAreaName.localeCompare(b.fill.workAreaName) ||
          a.shiftIndex - b.shiftIndex ||
          a.fill.employeeId.localeCompare(b.fill.employeeId),
      )
      .map((entry) => entry.fill);
  }

  const plans: RosterPlanOption[] = planRows.map((row) => ({
    id: row.id,
    status: row.status,
    version: row.version,
    locationName: row.locationName,
    siteName: row.siteName,
  }));

  // Discarding is offered to the writing roles on a draft; the page lists
  // weekly plans only, and daily plans are never discardable.
  const canDiscard = canWrite && chosen?.status === "draft";

  return (
    <RosterWeekView
      week={week}
      canWrite={canWrite}
      sites={sites}
      siteLocations={siteLocations}
      locationId={locationId}
      plans={plans}
      selectedPlanId={chosen?.id ?? null}
      plan={planView}
      dailyFills={dailyFills}
      gate={gate}
      totals={weeklyRows.length > 0 ? coverageTotals(weeklyRows) : null}
      violationHead={violations
        .slice(0, 3)
        .map((v) => `${v.rule} · ${v.message}`)}
      violationCount={violations.length}
      blockingViolationCount={blockingViolationCount}
      requirements={{
        rows,
        areaNames,
        shiftLabels,
        positionNames: Object.fromEntries(
          positionRows.map((p) => [p.id, p.name]),
        ),
      }}
      workAreaId={workAreaId}
      canDiscard={canDiscard}
      discardAssignmentCount={bundle ? bundle.rows.length : null}
    />
  );
}

// The generate gate's server truth: approved weekly requests of the week
// and location, and their line count.
async function countApproved(
  actor: Actor,
  locationId: string,
  week: string,
): Promise<{ requests: number; headcount: number }> {
  const [row] = await db
    .select({
      requests: countDistinct(mpRequest.id),
      headcount: sql<number>`coalesce(sum(${mpRequestLine.headcount}), 0)`.mapWith(Number),
    })
    .from(mpRequest)
    .leftJoin(mpRequestLine, eq(mpRequestLine.requestId, mpRequest.id))
    .where(
      and(
        eq(mpRequest.type, "weekly"),
        eq(mpRequest.weekStart, week),
        eq(mpRequest.status, "approved"),
        eq(mpRequest.siteLocationId, locationId),
        mpRequestListWhere(actor),
      ),
    );
  return { requests: row?.requests ?? 0, headcount: row?.headcount ?? 0 };
}

// Assignments of the location's daily plans dated inside the week: the
// filled side of the daily coverage rows.
async function loadDailyAssignments(
  actor: Actor,
  locationId: string,
  dates: string[],
): Promise<RosterAssignment[]> {
  const rows = await db
    .select({
      workerId: rosterAssignment.workerId,
      date: rosterAssignment.date,
      shiftDefId: rosterAssignment.shiftDefinitionId,
      workAreaId: rosterAssignment.workAreaId,
    })
    .from(rosterAssignment)
    .innerJoin(rosterPlan, eq(rosterAssignment.planId, rosterPlan.id))
    .where(
      and(
        eq(rosterPlan.kind, "daily"),
        eq(rosterPlan.siteLocationId, locationId),
        gte(rosterPlan.requestDate, dates[0]),
        lte(rosterPlan.requestDate, dates[dates.length - 1]),
        rosterPlanListWhere(actor),
      ),
    );
  return rows;
}
