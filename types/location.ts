// siteName can be null only through the left join that produces the list;
// the select label falls back to the bare location name.
export type LocationOption = {
  id: string;
  name: string;
  siteId: string;
  siteName: string | null;
};

import type { LocationTimezone } from "./timezone";

// One row of the locations table — server-selectable fields only.
export type LocationRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
  timezone: LocationTimezone;
};

// One row of the deleted-locations table. deletedAt travels as an ISO string
// so the server and the client render the same text.
export type DeletedLocationRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteName: string;
  deletedAt: string;
};
