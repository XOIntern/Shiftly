// One line of an MP request as the table/detail/edit views see it: names
// ride along from the server's joins so the client never re-looks them up.
export type MpRequestLineView = {
  workAreaId: string;
  workAreaName: string;
  shiftDefinitionId: string;
  shiftLabel: string;
  positionId: string;
  positionName: string;
  date: string;
  headcount: number;
};

// One row of the requests table — server-selectable fields only. siteName /
// locationName come from the required inner joins; lines is the request's
// whole line set (the detail and edit dialogs compose from it in place).
export type MpRequestRow = {
  id: string;
  type: "weekly" | "daily";
  status: "open" | "approved" | "fulfilled" | "rejected" | "withdrawn";
  weekStart: string | null;
  requestDate: string | null;
  siteLocationId: string;
  siteName: string;
  locationName: string;
  lines: MpRequestLineView[];
  updatedAt: string;
  // True only for a weekly request whose week already has a roster plan.
  rosterLocked: boolean;
};

// A week that already holds a live weekly request at one location, for the
// week-start calendar's markers. open / approved take the week (the DB slot
// is held); fulfilled alone leaves it selectable as an addition.
export type RequestedWeekStatus = "open" | "approved" | "fulfilled";

export type RequestedWeek = {
  weekStart: string;
  status: RequestedWeekStatus;
};

// Active masters for the request grid (create + edit dialogs): the rows of
// the grid are the work areas × shifts × required positions of ONE
// location, so all carry the siteLocationId they were scoped to. An area's
// positions are its live + active required positions (the
// work_area_position pivot), name-ascending — areas with none contribute
// no grid rows.
export type MpRequestGridPosition = {
  id: string;
  name: string;
};

export type MpRequestGridWorkArea = {
  id: string;
  name: string;
  siteLocationId: string;
  positions: MpRequestGridPosition[];
};

export type MpRequestGridShift = {
  id: string;
  label: string;
  siteLocationId: string;
  orderIndex: number;
  startTime: string;
  endTime: string;
};
