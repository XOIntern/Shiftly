import type { RequirementLine } from "./generate";
import type { RosterAssignment } from "@/types/engine";

// Pure coverage: how much of the demanded headcount the roster has filled,
// per work area · shift. An assignment carries no position, so a filled slot
// cannot be attributed to a position — positions only appear as the demanded
// breakdown of a row.

export type CoverageRequirement = RequirementLine & {
  source: "weekly" | "daily";
  requestId?: string;
};

export type CoverageRow = {
  key: string; // `${source}|${workAreaId}|${shiftDefId}|${date ?? "week"}`
  source: "weekly" | "daily";
  workAreaId: string;
  shiftDefId: string;
  date: string | null; // null on weekly rows (whole week); the date on daily rows
  positions: { positionId: string; headcount: number; requestId?: string }[];
  required: number;
  filled: number; // weekly: sum over dates of min(required_d, filled_d); daily: min(required, filled)
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function countAssignments(assignments: RosterAssignment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.workAreaId}|${a.shiftDefId}|${a.date}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

type Group = {
  source: "weekly" | "daily";
  workAreaId: string;
  shiftDefId: string;
  date: string | null;
  // Demand per date: a weekly row spans several dates, a daily row has one.
  demandByDate: Map<string, number>;
  positions: Map<string, { positionId: string; headcount: number; requestId?: string }>;
};

export function computeCoverage(
  requirements: CoverageRequirement[],
  weeklyAssignments: RosterAssignment[],
  dailyAssignments: RosterAssignment[],
): CoverageRow[] {
  const groups = new Map<string, Group>();
  for (const req of requirements) {
    const date = req.source === "daily" ? req.date : null;
    const key = `${req.source}|${req.workAreaId}|${req.shiftDefId}|${date ?? "week"}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        source: req.source,
        workAreaId: req.workAreaId,
        shiftDefId: req.shiftDefId,
        date,
        demandByDate: new Map(),
        positions: new Map(),
      };
      groups.set(key, group);
    }
    group.demandByDate.set(req.date, (group.demandByDate.get(req.date) ?? 0) + req.headcount);

    const position = group.positions.get(req.positionId);
    if (position) position.headcount += req.headcount;
    else {
      group.positions.set(req.positionId, {
        positionId: req.positionId,
        headcount: req.headcount,
        ...(req.requestId ? { requestId: req.requestId } : {}),
      });
    }
  }

  const weeklyCounts = countAssignments(weeklyAssignments);
  const dailyCounts = countAssignments(dailyAssignments);

  const rows: CoverageRow[] = [];
  for (const [key, group] of groups) {
    const counts = group.source === "weekly" ? weeklyCounts : dailyCounts;
    let required = 0;
    let filled = 0;
    for (const [date, demand] of group.demandByDate) {
      required += demand;
      const assigned = counts.get(`${group.workAreaId}|${group.shiftDefId}|${date}`) ?? 0;
      filled += Math.min(demand, assigned);
    }
    rows.push({
      key,
      source: group.source,
      workAreaId: group.workAreaId,
      shiftDefId: group.shiftDefId,
      date: group.date,
      positions: [...group.positions.values()],
      required,
      filled,
    });
  }

  rows.sort(
    (a, b) =>
      compare(a.source === "weekly" ? "0" : "1", b.source === "weekly" ? "0" : "1") ||
      compare(a.workAreaId, b.workAreaId) ||
      compare(a.shiftDefId, b.shiftDefId) ||
      compare(a.date ?? "", b.date ?? ""),
  );
  return rows;
}

export function coverageTotals(rows: CoverageRow[]): { required: number; filled: number } {
  let required = 0;
  let filled = 0;
  for (const row of rows) {
    required += row.required;
    filled += row.filled;
  }
  return { required, filled };
}

// Daily fills carry no request id, and a date holds one daily plan, so the
// fills of an already fulfilled daily request sit on the same
// area · shift · date as an open sibling's demand. Before coverage, drop as
// many fills per slot as the fulfilled requests demanded there, so only the
// remainder can count toward the open request.
export function withoutFulfilledDailyFills(
  dailyAssignments: RosterAssignment[],
  fulfilledLines: { workAreaId: string; shiftDefId: string; date: string; headcount: number }[],
): RosterAssignment[] {
  const toDrop = new Map<string, number>();
  for (const line of fulfilledLines) {
    const key = `${line.workAreaId}|${line.shiftDefId}|${line.date}`;
    toDrop.set(key, (toDrop.get(key) ?? 0) + line.headcount);
  }
  return dailyAssignments.filter((a) => {
    const key = `${a.workAreaId}|${a.shiftDefId}|${a.date}`;
    const left = toDrop.get(key) ?? 0;
    if (left <= 0) return true;
    toDrop.set(key, left - 1);
    return false;
  });
}
