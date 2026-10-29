import {
  computeCoverage,
  coverageTotals,
  withoutFulfilledDailyFills,
  type CoverageRequirement,
} from "@/lib/engine/coverage";
import type { RequirementLine } from "@/lib/engine/generate";
import {
  latestPublishedWeeklyPlan,
  loadDailyAssignmentsInRange,
  loadDailyRequirements,
  loadFulfilledDailyLines,
  loadPlanWithRows,
  loadRequirementsForWeek,
  type FulfilledDailyLine,
} from "@/lib/roster-data";
import { weekDates } from "@/lib/week";
import type { RosterAssignment } from "@/types/engine";
import type { ScopeActor } from "@/types/session";

import { clockFor } from "./clock";
import { loadScopedLocations } from "./locations";

export type CoverageInput = {
  weeklyLines: RequirementLine[];
  dailyLines: RequirementLine[];
  weeklyAssignments: RosterAssignment[];
  dailyAssignments: RosterAssignment[];
  fulfilledDailyLines: FulfilledDailyLine[];
};

// required/filled/deficit cover weekly plus daily demand. Only the latest
// published weekly plan counts for weekly fills; daily fills come from daily
// plans of any status, picked by assignment date. This intentionally differs
// from the roster page's headline figure, which counts the weekly rows of the
// selected plan only.
export type LocationCoverage = {
  locationId: string;
  locationName: string;
  siteName: string;
  week: string;
  required: number;
  filled: number;
  deficit: number;
};

// The week's headcount coverage, weekly and daily demand together, through
// the roster page's own engine calls: requirements tagged by source, daily
// fills of fulfilled daily requests dropped first. The engine caps each
// slot's fill at its demand, so the deficit is never negative.
export function deriveCoverage(input: CoverageInput): {
  required: number;
  filled: number;
  deficit: number;
} {
  const requirements: CoverageRequirement[] = [
    ...input.weeklyLines.map((line) => ({ ...line, source: "weekly" as const })),
    ...input.dailyLines.map((line) => ({ ...line, source: "daily" as const })),
  ];
  const { required, filled } = coverageTotals(
    computeCoverage(
      requirements,
      input.weeklyAssignments,
      withoutFulfilledDailyFills(input.dailyAssignments, input.fulfilledDailyLines),
    ),
  );
  return { required, filled, deficit: required - filled };
}

// This week's coverage per location in scope, each at its own week. Only the
// latest published weekly plan counts as filled: a draft is not a roster yet,
// and a revised week's older versions are superseded. Locations come from
// loadScopedLocations, so the unscoped roster-data loaders only ever see
// locations the actor may read.
export async function loadRosterCoverage(
  actor: ScopeActor,
  now: Date,
): Promise<LocationCoverage[]> {
  const locations = await loadScopedLocations(actor);

  return Promise.all(
    locations.map(async (loc) => {
      const { week } = clockFor(loc.timezone, now);
      const dates = weekDates(week);
      const from = dates[0];
      const to = dates[dates.length - 1];

      const [weeklyLines, dailyLines, published, dailyAssignments, fulfilledDailyLines] =
        await Promise.all([
          loadRequirementsForWeek(loc.id, week),
          loadDailyRequirements(loc.id, from, to),
          latestPublishedWeeklyPlan(loc.id, week),
          loadDailyAssignmentsInRange(loc.id, from, to),
          loadFulfilledDailyLines(loc.id, from, to),
        ]);
      const bundle = published ? await loadPlanWithRows(published.id) : null;

      return {
        locationId: loc.id,
        locationName: loc.name,
        siteName: loc.siteName,
        week,
        ...deriveCoverage({
          weeklyLines,
          dailyLines,
          weeklyAssignments: bundle?.assignments ?? [],
          dailyAssignments,
          fulfilledDailyLines,
        }),
      };
    }),
  );
}
