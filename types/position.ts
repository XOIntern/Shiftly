// One row of the positions table — server-selectable fields only.
// siteName comes from the required inner join, so it can't be null.
export type PositionRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};

// One row of the deleted-positions table. deletedAt travels as an ISO string
// so the server and the client render the same text.
export type DeletedPositionRow = {
  id: string;
  name: string;
  siteName: string;
  deletedAt: string;
};
