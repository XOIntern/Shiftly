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

// One row of the deleted-sites table. deletedAt travels as an ISO string so
// the server and the client render the same text.
export type DeletedSiteRow = {
  id: string;
  name: string;
  deletedAt: string;
};
