import { describe, expect, test } from "bun:test";

import {
  computeCoverage,
  coverageTotals,
  withoutFulfilledDailyFills,
  type CoverageRequirement,
} from "./coverage";
import { computeDeficit } from "./deficit";
import type { RosterAssignment } from "@/types/engine";

// Coverage is progress per work area · shift. Assignments carry no
// position, so a filled slot cannot be attributed to a position: positions
// only appear as the demanded breakdown.

const DAYS = ["2026-01-05", "2026-01-06", "2026-01-07"];

const weekly = (
  date: string,
  headcount: number,
  { workAreaId = "wa-a", shiftDefId = "s0", positionId = "pos-a", requestId }: {
    workAreaId?: string;
    shiftDefId?: string;
    positionId?: string;
    requestId?: string;
  } = {},
): CoverageRequirement => ({
  source: "weekly",
  workAreaId,
  shiftDefId,
  positionId,
  date,
  headcount,
  ...(requestId ? { requestId } : {}),
});

const daily = (
  date: string,
  headcount: number,
  requestId: string,
  { workAreaId = "wa-a", shiftDefId = "s0", positionId = "pos-a" } = {},
): CoverageRequirement => ({
  source: "daily",
  workAreaId,
  shiftDefId,
  positionId,
  date,
  headcount,
  requestId,
});

const assign = (
  workerId: string,
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
): RosterAssignment => ({ workerId, date, shiftDefId, workAreaId });

const many = (n: number, date: string, shiftDefId = "s0", workAreaId = "wa-a") =>
  Array.from({ length: n }, (_, i) => assign(`w-${date}-${i}`, date, shiftDefId, workAreaId));

describe("computeCoverage", () => {
  test("fully staffed week → filled equals required", () => {
    const reqs = DAYS.map((d) => weekly(d, 2));
    const assignments = DAYS.flatMap((d) => many(2, d));
    const rows = computeCoverage(reqs, assignments, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].required).toBe(6);
    expect(rows[0].filled).toBe(6);
    expect(rows[0].key).toBe("weekly|wa-a|s0|week");
    expect(rows[0].date).toBeNull();
  });

  test("a short day shows 42/50 style totals", () => {
    const days = Array.from({ length: 5 }, (_, i) => `2026-01-0${i + 5}`);
    const reqs = days.map((d) => weekly(d, 10));
    // 10,10,10,10 then 2 on the last day → 42 of 50
    const assignments = [
      ...days.slice(0, 4).flatMap((d) => many(10, d)),
      ...many(2, days[4]),
    ];
    const rows = computeCoverage(reqs, assignments, []);
    expect(coverageTotals(rows)).toEqual({ required: 50, filled: 42 });
  });

  test("surplus on one day does not hide a shortage on another (per-day cap)", () => {
    const reqs = [weekly("2026-01-05", 2), weekly("2026-01-06", 2)];
    const assignments = [...many(5, "2026-01-05"), ...many(1, "2026-01-06")];
    const [row] = computeCoverage(reqs, assignments, []);
    expect(row.required).toBe(4);
    expect(row.filled).toBe(3); // min(2,5) + min(2,1), not 4
  });

  test("an area·shift with no assignments has filled 0", () => {
    const reqs = [weekly("2026-01-05", 3, { workAreaId: "wa-b", shiftDefId: "s1" })];
    const [row] = computeCoverage(reqs, many(2, "2026-01-05"), []);
    expect(row.workAreaId).toBe("wa-b");
    expect(row.shiftDefId).toBe("s1");
    expect(row.required).toBe(3);
    expect(row.filled).toBe(0);
  });

  test("positions list carries every demanded position with its headcount and requestId", () => {
    const reqs = [
      daily("2026-01-05", 2, "req-1", { positionId: "pos-a" }),
      daily("2026-01-05", 3, "req-2", { positionId: "pos-b" }),
      daily("2026-01-05", 1, "req-3", { positionId: "pos-a" }),
    ];
    const [row] = computeCoverage(reqs, [], []);
    expect(row.required).toBe(6);
    expect(row.positions).toEqual([
      { positionId: "pos-a", headcount: 3, requestId: "req-1" },
      { positionId: "pos-b", headcount: 3, requestId: "req-2" },
    ]);
  });

  test("weekly positions sum headcount across dates and omit requestId when the line has none", () => {
    const reqs = [
      weekly("2026-01-05", 2, { positionId: "pos-a" }),
      weekly("2026-01-06", 2, { positionId: "pos-a" }),
      weekly("2026-01-06", 1, { positionId: "pos-b" }),
    ];
    const [row] = computeCoverage(reqs, [], []);
    expect(row.positions).toEqual([
      { positionId: "pos-a", headcount: 4 },
      { positionId: "pos-b", headcount: 1 },
    ]);
  });

  test("daily requirements become separate rows per date, matched against dailyAssignments only", () => {
    const reqs = [
      weekly("2026-01-05", 2),
      daily("2026-01-05", 2, "req-1"),
      daily("2026-01-06", 3, "req-2"),
    ];
    const weeklyAssignments = many(2, "2026-01-05");
    const dailyAssignments = [...many(1, "2026-01-06")];
    const rows = computeCoverage(reqs, weeklyAssignments, dailyAssignments);
    expect(rows.map((r) => r.key)).toEqual([
      "weekly|wa-a|s0|week",
      "daily|wa-a|s0|2026-01-05",
      "daily|wa-a|s0|2026-01-06",
    ]);
    expect(rows[0]).toMatchObject({ source: "weekly", required: 2, filled: 2 });
    // weekly assignments never count toward the daily row for the same date
    expect(rows[1]).toMatchObject({ source: "daily", date: "2026-01-05", required: 2, filled: 0 });
    expect(rows[2]).toMatchObject({ source: "daily", date: "2026-01-06", required: 3, filled: 1 });
  });

  test("rows are ordered weekly first, then daily, each by area, shift, date", () => {
    const reqs = [
      daily("2026-01-06", 1, "r1", { workAreaId: "wa-a", shiftDefId: "s0" }),
      daily("2026-01-05", 1, "r2", { workAreaId: "wa-a", shiftDefId: "s0" }),
      weekly("2026-01-05", 1, { workAreaId: "wa-b", shiftDefId: "s0" }),
      weekly("2026-01-05", 1, { workAreaId: "wa-a", shiftDefId: "s1" }),
      weekly("2026-01-05", 1, { workAreaId: "wa-a", shiftDefId: "s0" }),
    ];
    expect(computeCoverage(reqs, [], []).map((r) => r.key)).toEqual([
      "weekly|wa-a|s0|week",
      "weekly|wa-a|s1|week",
      "weekly|wa-b|s0|week",
      "daily|wa-a|s0|2026-01-05",
      "daily|wa-a|s0|2026-01-06",
    ]);
  });

  test("empty requirements → []", () => {
    expect(computeCoverage([], many(3, "2026-01-05"), many(1, "2026-01-05"))).toEqual([]);
  });

  test("coverageTotals sums required and filled", () => {
    expect(coverageTotals([])).toEqual({ required: 0, filled: 0 });
    const rows = computeCoverage(
      [weekly("2026-01-05", 4), weekly("2026-01-05", 3, { shiftDefId: "s1" })],
      [...many(3, "2026-01-05"), ...many(3, "2026-01-05", "s1")],
      [],
    );
    expect(coverageTotals(rows)).toEqual({ required: 7, filled: 6 });
  });

  test("consistency: for weekly rows, sum(required - filled) equals sum of computeDeficit(...).missing over the same data", () => {
    // Includes an over-filled day: both sides count missing per day, so a
    // surplus never offsets a shortage elsewhere.
    const reqs = [
      weekly("2026-01-05", 3, { positionId: "pos-a" }),
      weekly("2026-01-05", 2, { positionId: "pos-b" }),
      weekly("2026-01-06", 4),
      weekly("2026-01-07", 2, { shiftDefId: "s1", workAreaId: "wa-b" }),
      weekly("2026-01-06", 1, { shiftDefId: "s1", workAreaId: "wa-b" }),
    ];
    const assignments = [
      ...many(4, "2026-01-05"),
      ...many(7, "2026-01-06"),
      ...many(1, "2026-01-07", "s1", "wa-b"),
    ];
    const rows = computeCoverage(reqs, assignments, []);
    const rowsMissing = rows.reduce((sum, r) => sum + (r.required - r.filled), 0);
    const deficitMissing = computeDeficit(reqs, assignments).reduce(
      (sum, d) => sum + d.missing,
      0,
    );
    expect(deficitMissing).toBeGreaterThan(0);
    expect(rowsMissing).toBe(deficitMissing);
  });
});

describe("withoutFulfilledDailyFills", () => {
  const fill = (workerId: string, date = "2026-01-07", shiftDefId = "s1"): RosterAssignment => ({
    workerId,
    date,
    shiftDefId,
    workAreaId: "a1",
  });

  test("drops as many fills per slot as fulfilled requests demanded there", () => {
    const kept = withoutFulfilledDailyFills(
      [fill("w1"), fill("w2"), fill("w3"), fill("w4", "2026-01-08")],
      [{ workAreaId: "a1", shiftDefId: "s1", date: "2026-01-07", headcount: 2 }],
    );
    expect(kept.map((a) => a.workerId)).toEqual(["w3", "w4"]);
  });

  test("a fulfilled demand larger than the fills leaves nothing on that slot only", () => {
    const kept = withoutFulfilledDailyFills(
      [fill("w1"), fill("w2", "2026-01-07", "s2")],
      [{ workAreaId: "a1", shiftDefId: "s1", date: "2026-01-07", headcount: 5 }],
    );
    expect(kept.map((a) => a.workerId)).toEqual(["w2"]);
  });

  test("with no fulfilled demand every fill is kept", () => {
    const fills = [fill("w1"), fill("w2")];
    expect(withoutFulfilledDailyFills(fills, [])).toEqual(fills);
  });

  test("an open row on a slot shared with a fulfilled sibling shows as short", () => {
    const rows = computeCoverage(
      [
        {
          source: "daily",
          workAreaId: "a1",
          shiftDefId: "s1",
          positionId: "p1",
          date: "2026-01-07",
          headcount: 1,
          requestId: "open",
        },
      ],
      [],
      withoutFulfilledDailyFills(
        [fill("w1")],
        [{ workAreaId: "a1", shiftDefId: "s1", date: "2026-01-07", headcount: 1 }],
      ),
    );
    expect(rows[0]).toMatchObject({ required: 1, filled: 0 });
  });
});
