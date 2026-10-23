// Site rows threaded into the table's SiteFilter (locations-page shape).
export type SiteOption = { id: string; name: string };

// A site_location the create/edit dialog may target.
export type SiteLocationOption = {
  id: string;
  name: string;
  siteId: string;
};

// One row of the sites table — server-selectable fields only.
export type SiteRow = {
  id: string;
  name: string;
  isActive: boolean;
};
