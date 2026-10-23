// siteName can be null only through the left join that produces the list;
// the select label falls back to the bare location name.
export type LocationOption = {
  id: string;
  name: string;
  siteId: string;
  siteName: string | null;
};

// One row of the locations table — server-selectable fields only.
export type LocationRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};
