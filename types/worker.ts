// One row of the workers table — server-selectable fields only.
// siteName/locationName come from the required inner joins, so they can't be
// null. positions is the worker's whole qualification set (multi-position
// spec, 2026-10-20), alphabetical by name, empty only defensively.
export type WorkerRow = {
  id: string;
  employeeId: string;
  name: string;
  isActive: boolean;
  contractEndDate: string | null;
  siteLocationId: string;
  siteId: string;
  siteName: string;
  locationName: string;
  positions: { id: string; name: string; isActive: boolean }[];
};
