import { and, count, eq, inArray, isNull } from "drizzle-orm";

import { mpRequest, rosterPlan, worker } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mpRequestListWhere } from "@/lib/mp-request-scope";
import { rosterPlanListWhere } from "@/lib/roster-scope";
import type { ScopeActor } from "@/types/session";

import { clockFor } from "./clock";
import { dayKey, deriveDay, loadDayInputs } from "./day-data";
import { loadScopedLocations } from "./locations";

export type RosterWeekStatus = "none" | "draft" | "published";

export type LocationOverviewRow = {
  locationId: string;
  locationName: string;
  siteId: string;
  siteName: string;
  activeWorkers: number;
  presentToday: number;
  scheduledToday: number;
  rosterStatus: RosterWeekStatus;
  openRequests: number;
};

// A published plan wins, otherwise any draft, otherwise nothing yet.
export function deriveRosterStatus(
  plans: { status: "draft" | "published" }[],
): RosterWeekStatus {
  if (plans.some((plan) => plan.status === "published")) return "published";
  if (plans.length > 0) return "draft";
  return "none";
}

// One row per location in scope, in the picker's order. Fixed queries however
// many locations there are: the locations, three grouped counts (active
// workers, this week's weekly plans, open requests) and one loadDayInputs
// call over each location's own today.
export async function loadLocationOverview(
  actor: ScopeActor,
  now: Date,
): Promise<LocationOverviewRow[]> {
  const locations = await loadScopedLocations(actor);
  if (locations.length === 0) return [];

  const locationIds = locations.map((loc) => loc.id);
  const clocks = new Map(
    locations.map((loc) => [loc.id, clockFor(loc.timezone, now)]),
  );
  const weeks = [...new Set([...clocks.values()].map((c) => c.week))];
  const days = locations.map((loc) => ({
    locationId: loc.id,
    date: clocks.get(loc.id)!.today,
  }));

  const [workerRows, planRows, requestRows, dayInputs] = await Promise.all([
    db
      .select({ locationId: worker.siteLocationId, total: count() })
      .from(worker)
      .where(
        and(
          inArray(worker.siteLocationId, locationIds),
          isNull(worker.deletedAt),
          eq(worker.isActive, true),
        ),
      )
      .groupBy(worker.siteLocationId),
    db
      .select({
        locationId: rosterPlan.siteLocationId,
        weekStart: rosterPlan.weekStart,
        status: rosterPlan.status,
      })
      .from(rosterPlan)
      .where(
        and(
          rosterPlanListWhere(actor),
          inArray(rosterPlan.siteLocationId, locationIds),
          eq(rosterPlan.kind, "weekly"),
          inArray(rosterPlan.weekStart, weeks),
        ),
      ),
    db
      .select({ locationId: mpRequest.siteLocationId, total: count() })
      .from(mpRequest)
      .where(
        and(
          mpRequestListWhere(actor),
          inArray(mpRequest.siteLocationId, locationIds),
          eq(mpRequest.status, "open"),
        ),
      )
      .groupBy(mpRequest.siteLocationId),
    loadDayInputs(days),
  ]);

  const workers = new Map(workerRows.map((row) => [row.locationId, row.total]));
  const requests = new Map(
    requestRows.map((row) => [row.locationId, row.total]),
  );

  return locations.map((loc, i) => {
    const clock = clocks.get(loc.id)!;
    const input = dayInputs.get(dayKey(loc.id, days[i].date)) ?? {
      roster: [],
      records: [],
    };
    const day = deriveDay(input);
    return {
      locationId: loc.id,
      locationName: loc.name,
      siteId: loc.siteId,
      siteName: loc.siteName,
      activeWorkers: workers.get(loc.id) ?? 0,
      presentToday: day.presentScheduled,
      scheduledToday: day.scheduled,
      // A weekly plan is anchored on its Monday, so the location's own week
      // picks the plans; the week set above is only a shared upper bound.
      rosterStatus: deriveRosterStatus(
        planRows.filter(
          (plan) =>
            plan.locationId === loc.id && plan.weekStart === clock.week,
        ),
      ),
      openRequests: requests.get(loc.id) ?? 0,
    };
  });
}
