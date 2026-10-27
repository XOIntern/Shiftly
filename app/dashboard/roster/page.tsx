import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";

import {
  mpRequest,
  mpRequestLine,
  position,
  rosterPlan,
  shiftDefinition,
  site,
  siteLocation,
  workArea,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireUser } from "@/lib/session";
import { mpRequestListWhere } from "@/lib/mp-request-scope";
import { mondayOf, weekDates } from "@/lib/week";
import { computeDeficit } from "@/lib/engine/deficit";
import type { EffectiveRules } from "@/types/engine";
import {
  loadPlanWithRows,
  loadRequirementsForWeek,
  loadWorkerProfiles,
} from "@/lib/roster-data";
import { planViolations } from "@/lib/roster-plan-mutations";
import { RosterWeekView } from "@/app/dashboard/roster/roster-week-view";
import type {
  GridPlanView,
  RosterPlanOption,
} from "@/app/dashboard/roster/roster-week-view";
import type { DailyLineRow } from "@/app/dashboard/roster/daily-requests";
import type { SiteLocationOption, SiteOption } from "@/types/site";

// Deliberate block: the page queries roster data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Grid rows (workers per work-area card) are sliced SERVER-SIDE — there is
// no unpaginated fetch anywhere on this page. The slice rides its own URL
// param (`rowPage`) because `page` belongs to the shared DataTable that
// backs the daily-requests list.
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

// Roster-plan scoping for the weekly list: superadmin unbounded, an admin
// pinned to their own site_location, an ho reading their site's plans (the
// roster scope's read grant — lib/roster-scope, spec decision 6).
function planListWhere(actor: Awaited<ReturnType<typeof requireUser>>) {
  if (actor.role === "superadmin") return undefined;
  if (actor.role === "admin") {
    return actor.siteLocationId
      ? eq(rosterPlan.siteLocationId, actor.siteLocationId)
      : sql`false`;
  }
  return actor.siteId ? eq(rosterPlan.siteId, actor.siteId) : sql`false`;
}

export default async function RosterPage({
  searchParams,
}: PageProps<"/dashboard/roster">) {
  const actor = await requireUser();
  const raw = await searchParams;
  const { q, page, pageSize } = parseTableSearchParams(raw, PAGE_SIZE_OPTIONS);

  // The week anchor: a whitelisted `week` param snapped to its Monday, else
  // the running week (lib/week's mondayOf — the request-form precedent).
  const today = new Date().toISOString().slice(0, 10);
  const weekParam = whitelistParam(raw, "week", isDateShape);
  const week = mondayOf(weekParam ?? today);
  const planIdParam = whitelistParam(raw, "planId", isUuid);
  const workAreaParam = whitelistParam(raw, "workAreaId", isUuid);
  const rowPageParam = whitelistParam(raw, "rowPage", isRowPage);

  const canGenerate = actor.role !== "ho";
  const isSuperadmin = actor.role === "superadmin";
  const dates = weekDates(week);

  // The location's plan list for the week (newest version first) with the
  // names the picker shows.
  const planRows = await db
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
        planListWhere(actor),
      ),
    )
    .orderBy(desc(rosterPlan.version), asc(siteLocation.name));

  // The URL's pick wins; otherwise the week's draft, else the newest plan.
  const requested = planIdParam
    ? planRows.find((p) => p.id === planIdParam)
    : undefined;
  const chosen =
    requested ??
    planRows.find((p) => p.status === "draft") ??
    planRows[0] ??
    null;

  // The generate gate's server truth: approved weekly line
  // counts per location for the week (an ho never sees the button; the
  // counts still scope to their site for consistency).
  const gateRows = await db
    .select({
      siteLocationId: mpRequest.siteLocationId,
      lines: count(),
    })
    .from(mpRequestLine)
    .innerJoin(mpRequest, eq(mpRequestLine.requestId, mpRequest.id))
    .where(
      and(
        eq(mpRequest.type, "weekly"),
        eq(mpRequest.weekStart, week),
        inArray(mpRequest.status, ["approved"]),
        mpRequestListWhere(actor),
      ),
    )
    .groupBy(mpRequest.siteLocationId);
  const requirementsByLocation = Object.fromEntries(
    gateRows.map((row) => [row.siteLocationId, row.lines]),
  );

  // The editor bundle for the chosen plan: rows, work areas, shifts, the
  // worker slice, and the publish gate's violation/deficit summary.
  let planView: GridPlanView | null = null;
  if (chosen) {
    const bundle = await loadPlanWithRows(chosen.id);
    if (bundle) {
      const [areaRows, shiftRows] = await Promise.all([
        db
          .select({ id: workArea.id, name: workArea.name })
          .from(workArea)
          .where(
            and(
              eq(workArea.siteLocationId, chosen.siteLocationId),
              eq(workArea.isActive, true),
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
          })
          .from(shiftDefinition)
          .where(
            and(
              eq(shiftDefinition.siteLocationId, chosen.siteLocationId),
              eq(shiftDefinition.isActive, true),
              isNull(shiftDefinition.deletedAt),
            ),
          )
          .orderBy(asc(shiftDefinition.orderIndex)),
      ]);

      const workAreaId =
        workAreaParam && areaRows.some((a) => a.id === workAreaParam)
          ? workAreaParam
          : (areaRows[0]?.id ?? "");

      // Distinct eligible workers for the card, then the one server slice.
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
      const workers = allWorkers.slice(
        (rowPage - 1) * ROWS_PER_PAGE,
        rowPage * ROWS_PER_PAGE,
      );

      // This card's cells only: a worker holds at most one assignment per
      // day (the plan-level unique), and a row of ANOTHER area must not
      // leak into this card.
      const cells: Record<string, string> = {};
      for (const row of bundle.rows) {
        if (row.workAreaId !== workAreaId) continue;
        cells[`${row.workerId}|${row.date}`] = row.shiftDefinitionId;
      }

      // The publish gate's numbers, recomputed per render from the same
      // pieces the actions use (planViolations + computeDeficit). After an
      // edit the action revalidates this path, refreshing both.
      const [violations, requirements] = await Promise.all([
        planViolations(
          chosen.siteLocationId,
          bundle.plan.rulesSnapshot as EffectiveRules,
          bundle.assignments,
        ),
        loadRequirementsForWeek(chosen.siteLocationId, week),
      ]);
      const deficitCount = computeDeficit(requirements, bundle.assignments).length;

      planView = {
        id: chosen.id,
        status: chosen.status,
        version: chosen.version,
        canEdit: canGenerate && chosen.status === "draft",
        readOnlyReason: canGenerate
          ? "Published — locked; revise to open the next draft."
          : "Read-only — rosters are managed by admins.",
        workAreas: areaRows,
        workAreaId,
        shifts: shiftRows,
        workers,
        workerTotal,
        rowPage,
        dates,
        cells,
        violationCount: violations.length,
        violationHead: violations
          .slice(0, 3)
          .map((v) => `${v.rule} · ${v.message}`),
        deficitCount,
      };
    }
  }

  // The daily tab's outstanding lines: approved daily requests
  // dated within the running week, honoring the shared table's q search
  // (work area, shift, position, location names) and page/pageSize URL state.
  const pattern = ilikePattern(q);
  const dailyWhere = and(
    eq(mpRequest.type, "daily"),
    inArray(mpRequest.status, ["approved"]),
    gte(mpRequestLine.date, dates[0]),
    lte(mpRequestLine.date, dates[dates.length - 1]),
    mpRequestListWhere(actor),
    ...(pattern
      ? [
          or(
            ilike(workArea.name, pattern),
            ilike(shiftDefinition.label, pattern),
            ilike(position.name, pattern),
            ilike(siteLocation.name, pattern),
          ),
        ]
      : []),
  );

  const [{ count: dailyTotal }] = await db
    .select({ count: count() })
    .from(mpRequestLine)
    .innerJoin(mpRequest, eq(mpRequestLine.requestId, mpRequest.id))
    .innerJoin(workArea, eq(mpRequestLine.workAreaId, workArea.id))
    .innerJoin(
      shiftDefinition,
      eq(mpRequestLine.shiftDefinitionId, shiftDefinition.id),
    )
    .innerJoin(position, eq(mpRequestLine.positionId, position.id))
    .innerJoin(siteLocation, eq(mpRequest.siteLocationId, siteLocation.id))
    .where(dailyWhere);
  const dailyPageCount = Math.max(1, Math.ceil(dailyTotal / pageSize));
  const dailyPage = Math.min(page, dailyPageCount);

  const dailyLines: DailyLineRow[] = await db
    .select({
      id: mpRequestLine.id,
      requestId: mpRequestLine.requestId,
      requestStatus: mpRequest.status,
      date: mpRequestLine.date,
      headcount: mpRequestLine.headcount,
      workAreaId: mpRequestLine.workAreaId,
      workAreaName: workArea.name,
      shiftDefinitionId: mpRequestLine.shiftDefinitionId,
      shiftLabel: shiftDefinition.label,
      positionId: mpRequestLine.positionId,
      positionName: position.name,
      siteLocationId: mpRequest.siteLocationId,
      locationName: siteLocation.name,
      siteName: site.name,
    })
    .from(mpRequestLine)
    .innerJoin(mpRequest, eq(mpRequestLine.requestId, mpRequest.id))
    .innerJoin(workArea, eq(mpRequestLine.workAreaId, workArea.id))
    .innerJoin(
      shiftDefinition,
      eq(mpRequestLine.shiftDefinitionId, shiftDefinition.id),
    )
    .innerJoin(position, eq(mpRequestLine.positionId, position.id))
    .innerJoin(siteLocation, eq(mpRequest.siteLocationId, siteLocation.id))
    .innerJoin(site, eq(mpRequest.siteId, site.id))
    .where(dailyWhere)
    .orderBy(asc(mpRequestLine.date), asc(workArea.name))
    .limit(pageSize)
    .offset((dailyPage - 1) * pageSize);

  // The generate dialog's masters: only writers load them. A superadmin
  // picks site+location (the action re-pins an admin's binding server-side).
  let sites: SiteOption[] = [];
  let siteLocations: SiteLocationOption[] = [];
  if (canGenerate) {
    if (isSuperadmin) {
      [siteLocations, sites] = await Promise.all([
        db
          .select({
            id: siteLocation.id,
            name: siteLocation.name,
            siteId: siteLocation.siteId,
          })
          .from(siteLocation)
          .where(isNull(siteLocation.deletedAt))
          .orderBy(asc(siteLocation.name)),
        db
          .selectDistinct({ id: site.id, name: site.name })
          .from(site)
          .where(isNull(site.deletedAt))
          .orderBy(asc(site.name)),
      ]);
    } else if (actor.siteLocationId) {
      const [pinned] = await db
        .select({
          id: siteLocation.id,
          name: siteLocation.name,
          siteId: siteLocation.siteId,
        })
        .from(siteLocation)
        .where(
          and(
            eq(siteLocation.id, actor.siteLocationId),
            isNull(siteLocation.deletedAt),
          ),
        )
        .limit(1);
      if (pinned) {
        siteLocations = [pinned];
        sites = [];
      }
    }
  }
  const pinnedLocationName =
    actor.role === "admin" ? (siteLocations[0]?.name ?? undefined) : undefined;
  const pinnedLocationId =
    actor.role === "admin" ? (siteLocations[0]?.id ?? undefined) : undefined;

  const plans: RosterPlanOption[] = planRows.map((row) => ({
    id: row.id,
    status: row.status,
    version: row.version,
    locationName: row.locationName,
    siteName: row.siteName,
  }));

  return (
    <RosterWeekView
      week={week}
      canGenerate={canGenerate}
      isSuperadmin={isSuperadmin}
      sites={sites}
      siteLocations={siteLocations}
      pinnedLocationName={pinnedLocationName}
      pinnedLocationId={pinnedLocationId}
      requirementsByLocation={requirementsByLocation}
      plans={plans}
      selectedPlanId={chosen?.id ?? null}
      plan={planView}
      daily={{
        lines: dailyLines,
        pageCount: dailyPageCount,
        total: dailyTotal,
        canFill: canGenerate,
        showLocation: actor.role !== "admin",
        showSite: isSuperadmin,
      }}
    />
  );
}
