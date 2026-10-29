import type { ScopeActor } from "@/types/session";

import { clockFor, type LocationClock } from "./clock";
import { loadScopedLocations } from "./locations";

export type QuickLink = { label: string; href: string };

// Pure: the three admin shortcuts for one location, aimed at that location's
// own week and today so each page opens already on the right day.
export function quickLinksFor(
  location: { id: string },
  clock: Pick<LocationClock, "today" | "week">,
): QuickLink[] {
  return [
    { label: "Create request", href: "/dashboard/requests/new" },
    {
      label: "Open this week's roster",
      href: `/dashboard/roster?week=${clock.week}&locationId=${location.id}`,
    },
    {
      label: "Record today's attendance",
      href: `/dashboard/attendance?location=${location.id}&date=${clock.today}`,
    },
  ];
}

// An admin is bound to one location; an unbound admin has none and gets no
// shortcuts.
export async function loadQuickLinks(
  actor: ScopeActor,
  now: Date,
): Promise<QuickLink[]> {
  const [location] = await loadScopedLocations(actor);
  if (!location) return [];
  return quickLinksFor(location, clockFor(location.timezone, now));
}
