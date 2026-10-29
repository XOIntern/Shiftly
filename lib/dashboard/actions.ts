import { and, eq, inArray, or } from "drizzle-orm";

import { mpRequest, rosterPlan } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mpRequestListWhere } from "@/lib/mp-request-scope";
import { rosterPlanListWhere } from "@/lib/roster-scope";
import type { ScopeActor } from "@/types/session";

import { clockFor, type LocationClock } from "./clock";
import {
  dayKey,
  deriveAttendanceBacklog,
  deriveDay,
  loadDayInputs,
  type LocationDay,
} from "./day-data";
import { loadScopedLocations } from "./locations";

const DAY_MS = 86_400_000;

export type LocationActions = {
  locationId: string;
  locationName: string;
  siteName: string;
  today: string;
  // Admin only: workers not yet recorded today, and the past days (of the 7
  // before today) that had roster rows and still have unrecorded workers.
  attendance: {
    today: number;
    incomplete: { count: number; oldest: string | null };
  } | null;
  // Week starts (this or next week) with a weekly draft; a revision draft
  // counts, because a draft is always unpublished work.
  weeklyDrafts: string[];
  // Admin only: weeks (this or next) with an approved weekly request and no
  // weekly plan of any status.
  readyToGenerate: string[];
  // Daily requests still waiting to be filled; weekly requests are created
  // approved, so an open weekly row is legacy and not counted.
  openRequests: { daily: number; oldestAgeDays: number | null };
};

export type ActionsInput = {
  role: ScopeActor["role"];
  location: { id: string; name: string; siteName: string };
  clock: LocationClock;
  now: Date;
  // The location's weekly plans of any status for this and next week.
  plans: { weekStart: string; status: "draft" | "published" }[];
  // The location's open requests (any anchor) and approved weekly requests.
  requests: {
    type: "weekly" | "daily";
    status: string;
    weekStart: string | null;
    createdAt: Date;
  }[];
  // Present for an admin only.
  attendance: {
    todayUnrecorded: number;
    pastDays: { date: string; unrecorded: number }[];
  } | null;
};

export function deriveLocationActions(input: ActionsInput): LocationActions {
  const { clock, plans, requests, attendance } = input;
  const weeks = [clock.week, clock.nextWeek];

  const weeklyDrafts = weeks.filter((week) =>
    plans.some((plan) => plan.weekStart === week && plan.status === "draft"),
  );
  const readyToGenerate =
    input.role === "admin"
      ? weeks.filter(
          (week) =>
            requests.some(
              (request) =>
                request.type === "weekly" &&
                request.status === "approved" &&
                request.weekStart === week,
            ) && !plans.some((plan) => plan.weekStart === week),
        )
      : [];

  const open = requests.filter(
    (request) => request.status === "open" && request.type === "daily",
  );
  const oldest = open.reduce<Date | null>(
    (min, request) =>
      min === null || request.createdAt < min ? request.createdAt : min,
    null,
  );

  return {
    locationId: input.location.id,
    locationName: input.location.name,
    siteName: input.location.siteName,
    today: clock.today,
    attendance: attendance
      ? {
          today: attendance.todayUnrecorded,
          incomplete: deriveAttendanceBacklog(attendance.pastDays),
        }
      : null,
    weeklyDrafts,
    readyToGenerate,
    openRequests: {
      daily: open.length,
      oldestAgeDays:
        oldest === null
          ? null
          : Math.max(
              0,
              Math.floor((input.now.getTime() - oldest.getTime()) / DAY_MS),
            ),
    },
  };
}

// Fixed queries however many locations are in scope: the locations, their
// weekly plans for this/next week, their open and approved-weekly requests
// and, for an admin only, the day inputs of today plus the 7 days before it.
export async function loadActions(
  actor: ScopeActor,
  now: Date,
): Promise<LocationActions[]> {
  const locations = await loadScopedLocations(actor);
  if (locations.length === 0) return [];

  const clocks = new Map(
    locations.map((loc) => [loc.id, clockFor(loc.timezone, now)]),
  );
  const locationIds = locations.map((loc) => loc.id);
  const weeks = [
    ...new Set([...clocks.values()].flatMap((c) => [c.week, c.nextWeek])),
  ];
  const isAdmin = actor.role === "admin";
  const days: LocationDay[] = isAdmin
    ? locations.flatMap((loc) => {
        const clock = clocks.get(loc.id)!;
        return [...clock.pastDays, clock.today].map((date) => ({
          locationId: loc.id,
          date,
        }));
      })
    : [];

  const [planRows, requestRows, dayInputs] = await Promise.all([
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
      .select({
        locationId: mpRequest.siteLocationId,
        type: mpRequest.type,
        status: mpRequest.status,
        weekStart: mpRequest.weekStart,
        createdAt: mpRequest.createdAt,
      })
      .from(mpRequest)
      .where(
        and(
          mpRequestListWhere(actor),
          inArray(mpRequest.siteLocationId, locationIds),
          or(
            eq(mpRequest.status, "open"),
            and(
              eq(mpRequest.type, "weekly"),
              eq(mpRequest.status, "approved"),
              inArray(mpRequest.weekStart, weeks),
            ),
          ),
        ),
      ),
    loadDayInputs(days),
  ]);

  return locations.map((loc) => {
    const clock = clocks.get(loc.id)!;
    return deriveLocationActions({
      role: actor.role,
      location: { id: loc.id, name: loc.name, siteName: loc.siteName },
      clock,
      now,
      plans: planRows.flatMap((row) =>
        row.locationId === loc.id && row.weekStart !== null
          ? [{ weekStart: row.weekStart, status: row.status }]
          : [],
      ),
      requests: requestRows.filter((row) => row.locationId === loc.id),
      attendance: isAdmin
        ? {
            todayUnrecorded: unrecordedOn(dayInputs, loc.id, clock.today),
            pastDays: clock.pastDays.map((date) => ({
              date,
              unrecorded: unrecordedOn(dayInputs, loc.id, date),
            })),
          }
        : null,
    });
  });
}

function unrecordedOn(
  inputs: Awaited<ReturnType<typeof loadDayInputs>>,
  locationId: string,
  date: string,
): number {
  const input = inputs.get(dayKey(locationId, date));
  return input ? deriveDay(input).unrecorded : 0;
}

export type ActionItem = {
  key: string;
  locationName: string;
  label: string;
  href: string;
  kind: "todo" | "info";
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const rosterHref = (locationId: string, week: string) =>
  `/dashboard/roster?week=${week}&locationId=${locationId}`;

// What the panel lists, per location in the given order. An admin sees all
// four kinds, all as todo; an HO sees drafts (todo) and daily requests still
// waiting to be filled (info, the admin acts on them).
export function actionItemsFor(
  actions: LocationActions[],
  role: "admin" | "ho",
): ActionItem[] {
  return actions.flatMap((loc) => {
    const items: ActionItem[] = [];
    const add = (
      slug: string,
      label: string,
      href: string,
      kind: ActionItem["kind"] = "todo",
    ) =>
      items.push({
        key: `${loc.locationId}:${slug}`,
        locationName: loc.locationName,
        label,
        href,
        kind,
      });

    if (role === "admin" && loc.attendance) {
      const { today, incomplete } = loc.attendance;
      if (today > 0) {
        add(
          "attendance-today",
          `${plural(today, "worker", "workers")} not recorded today`,
          `/dashboard/attendance?location=${loc.locationId}&date=${loc.today}`,
        );
      }
      if (incomplete.count > 0 && incomplete.oldest) {
        add(
          "attendance-past",
          `${plural(incomplete.count, "earlier day", "earlier days")} not fully recorded`,
          `/dashboard/attendance?location=${loc.locationId}&date=${incomplete.oldest}`,
        );
      }
    }

    for (const week of loc.weeklyDrafts) {
      add(
        `draft:${week}`,
        `Roster draft for week of ${week} is not published`,
        rosterHref(loc.locationId, week),
      );
    }

    if (role === "admin") {
      for (const week of loc.readyToGenerate) {
        add(
          `generate:${week}`,
          `Request for week of ${week} is ready to generate`,
          rosterHref(loc.locationId, week),
        );
      }
    }

    const { daily, oldestAgeDays } = loc.openRequests;
    if (daily > 0) {
      const age =
        oldestAgeDays === null
          ? ""
          : oldestAgeDays === 0
            ? ", oldest today"
            : `, oldest ${plural(oldestAgeDays, "day", "days")}`;
      add(
        "open-requests",
        `${plural(daily, "daily request", "daily requests")} waiting to be filled${age}`,
        "/dashboard/requests?status=open&type=daily",
        role === "admin" ? "todo" : "info",
      );
    }

    return items;
  });
}
