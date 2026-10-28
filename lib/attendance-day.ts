import type {
  DayRow,
  RecordInput,
  RosterRowInput,
} from "../types/attendance";

// Pure: no I/O. The day list is the roster rows of the day joined to the
// attendance recorded so far; the loader (lib/attendance-data.ts) feeds it.

// One row per worker: the union of roster workers and record workers, ordered
// by workerId (the caller sorts for display).
//
// A recorded row reads its rostered side from the record itself (the shift
// and area the roster named when it was recorded), so a roster revised
// afterwards never makes the row flicker, flip its "shift differs" flag or
// appear twice. A worker on the roster more than once (weekly plan plus daily
// plan) counts once, the first row winning.
export function buildDayRows(
  roster: RosterRowInput[],
  records: RecordInput[],
): DayRow[] {
  const rosterByWorker = new Map<string, RosterRowInput>();
  for (const row of roster) {
    if (!rosterByWorker.has(row.workerId)) rosterByWorker.set(row.workerId, row);
  }
  const recordByWorker = new Map<string, RecordInput>();
  for (const rec of records) recordByWorker.set(rec.workerId, rec);

  const workerIds = new Set([...rosterByWorker.keys(), ...recordByWorker.keys()]);
  return [...workerIds].sort().map((workerId): DayRow => {
    const rostered = rosterByWorker.get(workerId) ?? null;
    const rec = recordByWorker.get(workerId) ?? null;

    if (!rec) {
      return {
        workerId,
        rosterShiftDefId: rostered?.shiftDefId ?? null,
        rosterWorkAreaId: rostered?.workAreaId ?? null,
        record: null,
        state: "unrecorded",
        shiftDiffers: false,
      };
    }

    if (rec.withoutRoster) {
      // Unscheduled when recorded; if the worker has since appeared on the
      // roster that is shown, but the row stays what it was recorded as.
      return {
        workerId,
        rosterShiftDefId: rostered?.shiftDefId ?? null,
        rosterWorkAreaId: rostered?.workAreaId ?? null,
        record: rec,
        state: "unscheduled",
        shiftDiffers: false,
      };
    }

    return {
      workerId,
      rosterShiftDefId: rec.rosteredShiftDefId,
      rosterWorkAreaId: rec.workAreaId,
      record: rec,
      state: "recorded",
      shiftDiffers: rec.shiftDefId !== rec.rosteredShiftDefId,
    };
  });
}

// Matches the effective shift and area: the record's when recorded, otherwise
// the roster's.
export function filterDayRows(
  rows: DayRow[],
  filter: { shiftDefId?: string; workAreaId?: string },
): DayRow[] {
  return rows.filter((row) => {
    const shiftDefId = row.record?.shiftDefId ?? row.rosterShiftDefId;
    const workAreaId = row.record?.workAreaId ?? row.rosterWorkAreaId;
    if (filter.shiftDefId && shiftDefId !== filter.shiftDefId) return false;
    if (filter.workAreaId && workAreaId !== filter.workAreaId) return false;
    return true;
  });
}

export function summarizeDayRows(rows: DayRow[]): {
  unrecorded: number;
  present: number;
  leave: number;
  sick: number;
  absent: number;
} {
  const summary = { unrecorded: 0, present: 0, leave: 0, sick: 0, absent: 0 };
  for (const row of rows) {
    if (row.record) summary[row.record.status] += 1;
    else summary.unrecorded += 1;
  }
  return summary;
}
