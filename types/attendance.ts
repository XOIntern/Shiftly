// Must stay in sync with attendanceStatusEnum (drizzle/schema/attendance-schema.ts).
export type AttendanceStatus = "present" | "leave" | "sick" | "absent";

// One roster row of the day (latest published weekly plan plus the daily
// plan), reduced to what the day list needs.
export type RosterRowInput = {
  workerId: string;
  workAreaId: string;
  shiftDefId: string;
};

// One recorded attendance row. shiftDefId is the shift actually worked;
// rosteredShiftDefId is the one the roster named when it was recorded, null
// for an unscheduled row (withoutRoster).
export type RecordInput = {
  id: string;
  workerId: string;
  shiftDefId: string;
  workAreaId: string;
  status: AttendanceStatus;
  withoutRoster: boolean;
  rosteredShiftDefId: string | null;
  reason: string | null;
};

export type DayRowState = "unrecorded" | "recorded" | "unscheduled";

// One line of the day page: one per worker, whether the worker is on the
// roster, recorded, or both.
export type DayRow = {
  workerId: string;
  rosterShiftDefId: string | null;
  rosterWorkAreaId: string | null;
  record: RecordInput | null;
  state: DayRowState;
  shiftDiffers: boolean;
};
