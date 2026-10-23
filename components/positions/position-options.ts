import type { PositionRow } from "@/types/position";

// Shared position-picker rules, extracted from the worker form so the
// work-area form can reuse them without a component-level import cycle
// (worker-form imports work-area-form for the location options).

// The position options admissible for one site pick: the deactivated ones
// never re-enter the picker (the page pre-filters — this is the defensive
// guard), and a picked site narrows the rest to its own positions.
export function positionOptionsFor(
  positions: PositionRow[],
  siteId: string | null,
): PositionRow[] {
  return positions.filter(
    (option) =>
      option.isActive && (siteId === null || option.siteId === siteId),
  );
}

// The rendered set: the site's active candidates plus every already-attached
// position of that site, even a deactivated one. An attachment must stay
// visible (and removable) so an unrelated edit never silently drops it.
export function visiblePositionOptions(
  positions: PositionRow[],
  siteId: string | null,
  selectedIds: string[],
): PositionRow[] {
  const candidates = positionOptionsFor(positions, siteId);
  const candidateIds = new Set(candidates.map((option) => option.id));
  const attached = positions.filter(
    (option) =>
      selectedIds.includes(option.id) &&
      !candidateIds.has(option.id) &&
      (siteId === null || option.siteId === siteId),
  );
  return [...candidates, ...attached].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

// An attached position stays selectable after it is deactivated, so both the
// chip and the list entry have to say so — otherwise the row reads like any
// other live option.
export function positionLabel(option: Pick<PositionRow, "name" | "isActive">) {
  return option.isActive ? option.name : `${option.name} (inactive)`;
}
