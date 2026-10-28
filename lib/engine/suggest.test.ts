import { describe, expect, test } from "bun:test";

import { DEFAULT_RULES } from "@/types/engine";
import type { EffectiveRule, EffectiveRules, RosterAssignment } from "@/types/engine";
import type { WorkerProfile } from "@/types/worker";
import { suggestReplacements } from "./suggest";
import type { RequirementLine } from "./generate";
import { validateRoster } from "./validate";

// Task 2 of the roster-engine plan: the replacement suggester — pure,
// deterministic, validator-clean candidates ranked by the same sortKey as
// the generator. No DB, no Next, no clock; rules enter only via parameters.

type Override = Partial<Record<"c1" | "c2" | "c5" | "c6", number>> &
  Partial<Record<"c3" | "c4" | "c7", boolean>>;

const rule = <T extends number | boolean>(
  value: T | undefined,
  fallback: EffectiveRule<T>,
): EffectiveRule<T> => (value === undefined ? fallback : { value, source: "site" });

const rules = (over: Override = {}): EffectiveRules => ({
  c1: rule(over.c1, DEFAULT_RULES.c1),
  c2: rule(over.c2, DEFAULT_RULES.c2),
  c3: rule(over.c3, DEFAULT_RULES.c3),
  c4: rule(over.c4, DEFAULT_RULES.c4),
  c5: rule(over.c5, DEFAULT_RULES.c5),
  c6: rule(over.c6, DEFAULT_RULES.c6),
  c7: rule(over.c7, DEFAULT_RULES.c7),
});

const mkShift = (order: number): string[] => Array.from({ length: order }, (_, i) => `s${i}`);

const mkWorker = (id: string, workAreaId = "wa-a", positionIds: readonly string[] = []) =>
  ({ id, employeeId: id, workAreaId, positionIds }) as WorkerProfile & {
    id: string;
    employeeId: string;
  };

const assign = (
  workerId: string,
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
): RosterAssignment => ({ workerId, date, shiftDefId, workAreaId });

const mkLine = (
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
  headcount = 1,
  positionId = "pos-a",
): RequirementLine => ({ workAreaId, shiftDefId, date, headcount, positionId });

describe("suggestReplacements (roster-engine task 2)", () => {
  test("returns only validator-clean candidates (week-full worker excluded)", () => {
    const workers = [
      mkWorker("w-full", "wa-a", ["pos-a"]),
      mkWorker("w-free", "wa-a", ["pos-a"]),
    ];
    const line = mkLine("2026-01-08");
    // w-full has 5 work days in the Mon-start week of 01-05 — one more day
    // would breach C1 = 5, so only w-free may be suggested.
    const prior: RosterAssignment[] = [
      assign("w-full", "2026-01-05"),
      assign("w-full", "2026-01-06"),
      assign("w-full", "2026-01-07"),
      assign("w-full", "2026-01-09"),
      assign("w-full", "2026-01-10"),
    ];

    const result = suggestReplacements(
      line,
      [],
      prior,
      workers,
      mkShift(3),
      {},
      rules(),
      5,
    );

    expect(result.map((c) => c.workerId)).toEqual(["w-free"]);
    expect(result[0].employeeId).toBe("w-free");
    expect(result[0].reason.length).toBeGreaterThan(0);
  });

  test("ranked by load: the least-loaded worker comes first", () => {
    const workers = [
      mkWorker("w-busy", "wa-a", ["pos-a"]),
      mkWorker("w-light", "wa-a", ["pos-a"]),
    ];
    const prior: RosterAssignment[] = [
      assign("w-busy", "2026-01-05"),
      assign("w-busy", "2026-01-06"),
      assign("w-light", "2026-01-02"), // prior week — does not count here
    ];

    const result = suggestReplacements(
      mkLine("2026-01-08"),
      [],
      prior,
      workers,
      mkShift(3),
      {},
      rules(),
      5,
    );

    expect(result.map((c) => c.workerId)).toEqual(["w-light", "w-busy"]);
    expect(result[0].reason).toMatch(/0 work days this week/);
  });

  test("respects the limit", () => {
    const workers = [
      mkWorker("w1", "wa-a", ["pos-a"]),
      mkWorker("w2", "wa-a", ["pos-a"]),
      mkWorker("w3", "wa-a", ["pos-a"]),
    ];

    const result = suggestReplacements(
      mkLine("2026-01-08"),
      [],
      [],
      workers,
      mkShift(3),
      {},
      rules(),
      2,
    );

    expect(result).toHaveLength(2);
  });

  test("a rotation-limited candidate is excluded", () => {
    const workers = [
      mkWorker("w-rot", "wa-a", ["pos-a"]),
      mkWorker("w-ok", "wa-a", ["pos-a"]),
    ];
    // w-rot worked s1 the day before; the line asks for s0 → downshift.
    const prior: RosterAssignment[] = [assign("w-rot", "2026-01-07", "s1")];

    const result = suggestReplacements(
      mkLine("2026-01-08"),
      [],
      prior,
      workers,
      mkShift(3),
      {},
      rules(),
      5,
    );

    expect(result.map((c) => c.workerId)).toEqual(["w-ok"]);
  });

  test("candidates whose weekly assignments make them dirty are excluded", () => {
    const workers = [
      mkWorker("w1", "wa-a", ["pos-a"]),
      mkWorker("w2", "wa-a", ["pos-a"]),
    ];
    // w1 is at the 5-day week limit in the CURRENT plan week; 01-08 would
    // be the 6th (01-02/01-03 belong to the prior week and don't matter).
    const weekly: RosterAssignment[] = [
      assign("w1", "2026-01-05"),
      assign("w1", "2026-01-06"),
      assign("w1", "2026-01-07"),
      assign("w1", "2026-01-09"),
      assign("w1", "2026-01-10"),
      assign("w1", "2026-01-02"), // prior week; harmless
      assign("w1", "2026-01-03"),
    ];

    const result = suggestReplacements(
      mkLine("2026-01-08"),
      weekly,
      [],
      workers,
      mkShift(3),
      {},
      rules(),
      5,
    );

    expect(result.map((c) => c.workerId)).toEqual(["w2"]);
  });

  test("unqualified workers are not suggested under C7", () => {
    const workers = [
      mkWorker("w1", "wa-a", ["pos-paint"]),
      mkWorker("w2", "wa-a", ["pos-weld"]),
    ];

    const result = suggestReplacements(
      mkLine("2026-01-08", "s0", "wa-a", 1, "pos-weld"),
      [],
      [],
      workers,
      mkShift(3),
      { "wa-a": ["pos-weld"] },
      rules({ c7: true }),
      5,
    );

    expect(result.map((c) => c.workerId)).toEqual(["w2"]);
  });

  test("the pool narrows to the line's exact position holder (#143)", () => {
    const workers = [
      mkWorker("w-a", "wa-a", ["pos-p1"]),
      mkWorker("w-b", "wa-a", ["pos-p2"]),
    ];

    const result = suggestReplacements(
      mkLine("2026-01-08", "s0", "wa-a", 1, "pos-p2"),
      [],
      [],
      workers,
      mkShift(3),
      { "wa-a": ["pos-p1", "pos-p2"] },
      rules({ c7: true }),
      5,
    );

    expect(result.map((c) => c.workerId)).toEqual(["w-b"]);
  });

  test("every returned candidate validates clean against the full ruleset", () => {
    const workers = [
      mkWorker("w1", "wa-a", ["pos-a"]),
      mkWorker("w2", "wa-a", ["pos-a"]),
      mkWorker("w3", "wa-a", ["pos-a"]),
    ];
    const prior: RosterAssignment[] = [
      assign("w1", "2026-01-05", "s2"),
      assign("w2", "2026-01-05", "s1"),
    ];

    const result = suggestReplacements(
      mkLine("2026-01-06", "s2"),
      [],
      prior,
      workers,
      mkShift(3),
      {},
      rules(),
      5,
    );

    const record: Record<string, WorkerProfile> = {
      w1: mkWorker("w1"),
      w2: mkWorker("w2"),
      w3: mkWorker("w3"),
    };
    for (const c of result) {
      const clean = validateRoster(
        [assign(c.workerId, "2026-01-06", "s2")],
        record,
        rules(),
        mkShift(3),
        {},
      );
      expect(clean).toEqual([]);
    }
    expect(result.map((c) => c.workerId)).toEqual(["w3", "w2"]);
  });

  describe("detail text names the nearest shift (#160)", () => {
    const reasonFor = (...dates: string[]): string => {
      const result = suggestReplacements(
        mkLine("2026-01-14"),
        [],
        dates.map((d) => assign("w1", d)),
        [mkWorker("w1", "wa-a", ["pos-a"])],
        mkShift(3),
        {},
        rules(),
        5,
      );
      expect(result).toHaveLength(1);
      return result[0].reason;
    };

    test("a shift before the date reads last shift Nd ago", () => {
      expect(reasonFor("2026-01-12")).toEndWith("last shift 2d ago");
    });

    test("a shift only after the date reads next shift in Nd, never negative", () => {
      const reason = reasonFor("2026-01-15");
      expect(reason).toEndWith("next shift in 1d");
      expect(reason).not.toContain("-");
    });

    test("the nearest shift wins when it is before the date", () => {
      expect(reasonFor("2026-01-13", "2026-01-20")).toEndWith("last shift 1d ago");
    });

    test("the nearest shift wins when it is after the date", () => {
      expect(reasonFor("2026-01-10", "2026-01-15")).toEndWith("next shift in 1d");
    });

    test("a tie between before and after prefers the earlier shift", () => {
      expect(reasonFor("2026-01-12", "2026-01-16")).toEndWith("last shift 2d ago");
    });

    test("no history reads no prior shifts", () => {
      expect(reasonFor()).toEndWith("no prior shifts");
    });
  });
});
