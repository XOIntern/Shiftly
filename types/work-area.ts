// A work-area row the page hands the actions — siteName comes from the
// required inner join, so it can't be null. locationName rides along from
// the row's location join (optional: dialogs that don't show it omit it).
// positions is the area's required-position set (roster spec §3.1), the
// edit dialog pre-fills its multi-select from it, alphabetical by name.
export type WorkAreaRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteLocationId: string;
  siteId: string;
  siteName: string;
  locationName?: string | null;
  positions: { id: string; name: string; isActive: boolean }[];
};
