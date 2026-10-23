// One row of the positions table — server-selectable fields only.
// siteName comes from the required inner join, so it can't be null.
export type PositionRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};
