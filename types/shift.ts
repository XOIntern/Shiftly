// One row of the shifts table — server-selectable fields only. siteName /
// locationName come from the required inner joins, so they can't be null.
export type ShiftRow = {
  id: string;
  label: string;
  orderIndex: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  siteLocationId: string;
  siteId: string;
  siteName: string;
  locationName: string;
};

// One row of the deleted-shifts table. deletedAt travels as an ISO string so
// the server and the client render the same text.
export type DeletedShiftRow = {
  id: string;
  label: string;
  orderIndex: number;
  startTime: string;
  endTime: string;
  siteName: string;
  locationName: string;
  deletedAt: string;
};
