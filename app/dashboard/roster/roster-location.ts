import type { SiteLocationOption } from "@/types/site";

// Which location the roster page acts on, and which of the week's plans it
// shows. Pure (and outside the client modules) so the server page resolves
// both once and hands the result down: the status bar, the gate counts, the
// requirements panel and the generate target all read the same location.

// An admin's pinned binding always wins. Otherwise the `locationId` URL pick
// when it names a location in scope, else the location of the plan the page
// would show, else the first in-scope location (the list is name-ordered).
// A superadmin or ho with several locations therefore always lands on one.
export function selectedLocationFor({
  pinnedLocationId,
  siteLocations,
  param,
  planLocationId,
}: {
  pinnedLocationId: string | null | undefined;
  siteLocations: Pick<SiteLocationOption, "id">[];
  param: string | null;
  planLocationId: string | null | undefined;
}): string | null {
  if (pinnedLocationId) return pinnedLocationId;
  const inScope = (id: string | null | undefined): id is string =>
    !!id && siteLocations.some((l) => l.id === id);
  if (inScope(param)) return param;
  if (inScope(planLocationId)) return planLocationId;
  return siteLocations[0]?.id ?? null;
}

// The URL's plan pick wins; otherwise the week's draft, else the first plan
// (callers order the list newest version first).
export function pickPlan<T extends { id: string; status: "draft" | "published" }>(
  plans: T[],
  requestedId: string | null,
): T | null {
  const requested = requestedId
    ? plans.find((p) => p.id === requestedId)
    : undefined;
  return (
    requested ?? plans.find((p) => p.status === "draft") ?? plans[0] ?? null
  );
}
