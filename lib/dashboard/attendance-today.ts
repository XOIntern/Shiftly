import type { ScopeActor } from "@/types/session";

import { clockFor } from "./clock";
import {
  dayKey,
  deriveDay,
  loadDayInputs,
  type DaySummary,
} from "./day-data";
import { loadScopedLocations } from "./locations";

export type LocationAttendance = {
  locationId: string;
  locationName: string;
  today: string;
  summary: DaySummary;
};

// Today's attendance per location in scope, each at its own today. One
// loadDayInputs call covers every location, and deriveDay is the attendance
// page's own summary, so the dashboard number equals the page's number.
export async function loadAttendanceToday(
  actor: ScopeActor,
  now: Date,
): Promise<LocationAttendance[]> {
  const locations = await loadScopedLocations(actor);
  if (locations.length === 0) return [];

  const days = locations.map((loc) => ({
    locationId: loc.id,
    date: clockFor(loc.timezone, now).today,
  }));
  const inputs = await loadDayInputs(days);

  return locations.map((loc, i) => {
    const { date } = days[i];
    const input = inputs.get(dayKey(loc.id, date)) ?? {
      roster: [],
      records: [],
    };
    return {
      locationId: loc.id,
      locationName: loc.name,
      today: date,
      summary: deriveDay(input),
    };
  });
}
