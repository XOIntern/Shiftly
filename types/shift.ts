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
