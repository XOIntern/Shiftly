import { describe, expect, test } from "bun:test";

import { computeDeficit } from "./deficit";
import type { RequirementLine } from "./generate";
import type { RosterAssignment } from "@/types/engine";

// Task 2 of the roster-engine plan: deficit computation — the pure
// bookkeeping layer that diffs requirement lines against filled
// assignments. Reason "unfilled": this module cannot know WHY a slot is
// empty, only that it is.

const line = (
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
  headcount = 1,
): RequirementLine => ({ workAreaId, shiftDefId, date, headcount });

const assign = (
  workerId: string,
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
): RosterAssignment => ({ workerId, date, shiftDefId, workAreaId });

describe("computeDeficit (roster-engine task 2)", () => {
  test("reports no deficits when every requirement line is fully filled", () => {
    const requirements = [line("2026-01-05", "s0", "wa-a", 2), line("2026-01-05", "s1", "wa-b", 1)];
    const assignments = [
      assign("w1", "2026-01-05", "s0", "wa-a"),
      assign("w2", "2026-01-05", "s0", "wa-a"),
      assign("w3", "2026-01-05", "s1", "wa-b"),
    ];

    expect(computeDeficit(requirements, assignments)).toEqual([]);
  });

  test("reports per-line missing counts with reason unfilled", () => {
    const requirements = [line("2026-01-05", "s0", "wa-a", 2), line("2026-01-06", "s2", "wa-b", 1)];
    const assignments = [assign("w1", "2026-01-05", "s0", "wa-a")];

    expect(computeDeficit(requirements, assignments)).toEqual([
      { workAreaId: "wa-a", shiftDefId: "s0", date: "2026-01-05", missing: 1, reason: "unfilled" },
      { workAreaId: "wa-b", shiftDefId: "s2", date: "2026-01-06", missing: 1, reason: "unfilled" },
    ]);
  });

  test("matches lines exactly on workAreaId + shiftDefId + date", () => {
    const requirements = [line("2026-01-05", "s0", "wa-a", 1)];
    // Same date/shift, different area; same area/day, different shift.
    const assignments = [
      assign("w1", "2026-01-05", "s0", "wa-b"),
      assign("w2", "2026-01-05", "s1", "wa-a"),
      assign("w3", "2026-01-06", "s0", "wa-a"),
    ];

    expect(computeDeficit(requirements, assignments)).toEqual([
      { workAreaId: "wa-a", shiftDefId: "s0", date: "2026-01-05", missing: 1, reason: "unfilled" },
    ]);
  });

  test("ignores overfilled lines and empty requirements", () => {
    const requirements = [line("2026-01-05", "s0", "wa-a", 1)];
    const assignments = [
      assign("w1", "2026-01-05", "s0", "wa-a"),
      assign("w2", "2026-01-05", "s0", "wa-a"),
    ];

    expect(computeDeficit(requirements, assignments)).toEqual([]);
    expect(computeDeficit([], assignments)).toEqual([]);
  });
});
