import { describe, expect, test } from "bun:test";

import { DEFAULT_RULES } from "@/types/engine";
import type { EffectiveRule, EffectiveRules, RosterAssignment } from "@/types/engine";
import type { WorkerProfile } from "@/types/worker";
import { resolveRules } from "./resolve";
import type { RuleConfigRow } from "@/types/domain";
import { validateRoster } from "./validate";

// Task 1 of the roster-engine plan: the pure validator over an ordered set
// of shift definitions. The engine speaks indices into `shiftOrder`, never
// numeric shifts. Rules C1–C7 are evaluated against the effective rules the
// caller resolved — the validator itself never reads defaults. No DB, no
// Next, no clock: assignments + worker profiles + rules in, violations out.

// Test weeks/months use 2026-01-05 (a Monday) and March 2026 (31 days).

type Override = Partial<Record<"c1" | "c2" | "c5" | "c6", number>> &
  Partial<Record<"c3" | "c4" | "c7", boolean>>;

const rule = <T extends number | boolean>(
  value: T | undefined,
  fallback: EffectiveRule<T>,
): EffectiveRule<T> => (value === undefined ? fallback : { value, source: "site" });

// Defaults unless a specific rule is overridden (marked source "site").
const rules = (over: Override = {}): EffectiveRules => ({
  c1: rule(over.c1, DEFAULT_RULES.c1),
  c2: rule(over.c2, DEFAULT_RULES.c2),
  c3: rule(over.c3, DEFAULT_RULES.c3),
  c4: rule(over.c4, DEFAULT_RULES.c4),
  c5: rule(over.c5, DEFAULT_RULES.c5),
  c6: rule(over.c6, DEFAULT_RULES.c6),
  c7: rule(over.c7, DEFAULT_RULES.c7),
});

// Fixture builder: an ordered shift list of `order` definitions with ids
// s0…s{n-1}, ascending order index.
const mkShift = (order: number): string[] =>
  Array.from({ length: order }, (_, i) => `s${i}`);

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
};

const assign = (
  workerId: string,
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
): RosterAssignment => ({ workerId, date, shiftDefId, workAreaId });

const consecutive = (start: string, count: number, shiftDefId = "s0"): RosterAssignment[] =>
  Array.from({ length: count }, (_, i) => assign("w1", addDays(start, i), shiftDefId));

const worker = (
  id: string,
  workAreaId = "wa-a",
  positionIds: readonly string[] = [],
): WorkerProfile => ({ workAreaId, positionIds });

const workers: Record<string, WorkerProfile> = { w1: worker("w1") };

const intRow = (ruleKey: RuleConfigRow["ruleKey"], value: number): RuleConfigRow => ({
  ruleKey,
  intValue: value,
  boolValue: null,
});

describe("validateRoster (roster-engine task 1)", () => {
  test("C1 flags the 6th work day in a week under defaults", () => {
    const assignments = consecutive("2026-01-05", 6); // Mon–Sat of the Mon-start week

    expect(validateRoster(assignments, workers, rules(), mkShift(3), {})).toEqual([
      { rule: "C1", workerId: "w1", date: "2026-01-10", message: expect.any(String) },
    ]);
  });

  test("C1 weeks start Monday: a Sunday assignment belongs to the previous week", () => {
    // Sun 01-04 .. Fri 01-09 is 6 consecutive work days; only under a
    // Monday-start week (01-04 in the prior week) do they stay within c1 = 5.
    const assignments = consecutive("2026-01-04", 6);

    expect(validateRoster(assignments, workers, rules(), mkShift(3), {})).toEqual([]);
  });

  test("C1 accepts 6 work days when the site resolves c1 = 6", () => {
    const siteRules = resolveRules([intRow("C1", 5)], [intRow("C1", 6)], []);
    const assignments = consecutive("2026-01-05", 6);

    expect(validateRoster(assignments, workers, siteRules, mkShift(3), {})).toEqual([]);
  });

  test("C2 flags the 21st work day in a month", () => {
    const assignments = consecutive("2026-03-01", 21);

    expect(validateRoster(assignments, workers, rules({ c1: 7 }), mkShift(3), {})).toEqual([
      { rule: "C2", workerId: "w1", date: "2026-03-21", message: expect.any(String) },
    ]);
  });

  test("C3 flags a downshift 3→1 on consecutive days (4-shift order)", () => {
    // s3 is the last shift, so the s1 day also violates C4 (day after the
    // last shift must rest) — both rules flag 01-06.
    const assignments = [
      assign("w1", "2026-01-05", "s3"),
      assign("w1", "2026-01-06", "s1"),
    ];

    expect(validateRoster(assignments, workers, rules(), mkShift(4), {})).toEqual([
      { rule: "C3", workerId: "w1", date: "2026-01-06", message: expect.any(String) },
      { rule: "C4", workerId: "w1", date: "2026-01-06", message: expect.any(String) },
    ]);
  });

  test("C3 accepts forward rotation through increasing order", () => {
    const assignments = [
      assign("w1", "2026-01-05", "s0"),
      assign("w1", "2026-01-06", "s1"),
      assign("w1", "2026-01-07", "s2"),
    ];

    expect(validateRoster(assignments, workers, rules(), mkShift(3), {})).toEqual([]);
  });

  test("C3 skips when disabled", () => {
    const assignments = [
      assign("w1", "2026-01-05", "s1"),
      assign("w1", "2026-01-06", "s0"),
    ];

    expect(validateRoster(assignments, workers, rules({ c3: false }), mkShift(3), {})).toEqual([]);
  });

  test("C3 compares consecutive days only, not across a rest day", () => {
    const assignments = [
      assign("w1", "2026-01-05", "s2"),
      assign("w1", "2026-01-07", "s0"), // 01-06 rested; rotation resets
    ];

    expect(validateRoster(assignments, workers, rules(), mkShift(3), {})).toEqual([]);
  });

  test("C4 flags work the day after the last-shift day", () => {
    // s2 is the last shift in a 3-shift order.
    const assignments = [
      assign("w1", "2026-01-05", "s2"),
      assign("w1", "2026-01-06", "s2"),
    ];

    expect(validateRoster(assignments, workers, rules(), mkShift(3), {})).toEqual([
      { rule: "C4", workerId: "w1", date: "2026-01-06", message: expect.any(String) },
    ]);
  });

  test("C4 accepts a rest day after the last-shift day", () => {
    const assignments = [assign("w1", "2026-01-05", "s2")];

    expect(validateRoster(assignments, workers, rules(), mkShift(3), {})).toEqual([]);
  });

  test("C4 skips when disabled", () => {
    const assignments = [
      assign("w1", "2026-01-05", "s3"),
      assign("w1", "2026-01-06", "s3"),
    ];

    expect(validateRoster(assignments, workers, rules({ c4: false }), mkShift(4), {})).toEqual([]);
  });

  test("C4 is tied to the last index of shiftOrder, not to a fixed shift", () => {
    // s1 is NOT the last shift in a 4-shift order → working the next day is fine.
    const assignments = [
      assign("w1", "2026-01-05", "s1"),
      assign("w1", "2026-01-06", "s1"),
    ];

    expect(validateRoster(assignments, workers, rules(), mkShift(4), {})).toEqual([]);
    // …but s3 (the last) followed by work IS flagged.
    const lastShift = [
      assign("w1", "2026-01-05", "s3"),
      assign("w1", "2026-01-06", "s3"),
    ];
    expect(validateRoster(lastShift, workers, rules(), mkShift(4), {})).toEqual([
      { rule: "C4", workerId: "w1", date: "2026-01-06", message: expect.any(String) },
    ]);
  });

  test("C5 flags an assigned day inside the owed break", () => {
    const assignments = consecutive("2026-01-05", 6); // c5=5 work days, then the 1st owed break day

    expect(validateRoster(assignments, workers, rules({ c1: 7, c5: 5, c6: 2 }), mkShift(3), {})).toEqual([
      { rule: "C5", workerId: "w1", date: "2026-01-10", message: expect.any(String) },
    ]);
  });

  test("C5 accepts a full break taken", () => {
    const assignments = [
      ...consecutive("2026-01-05", 5), // Mon–Fri reaches c5 = 5
      assign("w1", "2026-01-12"), // resumes after the 2-day owed break (01-10, 01-11)
    ];

    expect(validateRoster(assignments, workers, rules({ c1: 7, c5: 5, c6: 2 }), mkShift(3), {})).toEqual([]);
  });

  test("C5 does not flag a break owed past the horizon", () => {
    const assignments = consecutive("2026-01-05", 5); // roster ends the day the break becomes owed

    expect(validateRoster(assignments, workers, rules({ c1: 7, c5: 5, c6: 2 }), mkShift(3), {})).toEqual([]);
  });

  test("C5 cross-plan: the owed window landing in the second week is still enforced", () => {
    // History week 1 puts the worker at c5 = 5 by Friday 01-09; week 2
    // assignments on 01-12/01-13 fall inside the 4-day owed break
    // (01-10 .. 01-13) and are flagged even though they start a new week.
    const assignments = [
      ...consecutive("2026-01-05", 5),
      assign("w1", "2026-01-12"),
      assign("w1", "2026-01-13"),
    ];

    expect(validateRoster(assignments, workers, rules({ c1: 7, c5: 5, c6: 4 }), mkShift(3), {})).toEqual([
      { rule: "C5", workerId: "w1", date: "2026-01-12", message: expect.any(String) },
      { rule: "C5", workerId: "w1", date: "2026-01-13", message: expect.any(String) },
    ]);
  });

  test("C7 passes when the worker holds a required position of the area", () => {
    const assignments = [assign("w1", "2026-01-05")];
    const w1 = worker("w1", "wa-a", ["pos-weld"]);
    const areaWorkers = { w1 };

    expect(
      validateRoster(assignments, areaWorkers, rules({ c7: true }), mkShift(3), {
        "wa-a": ["pos-weld", "pos-line"],
      }),
    ).toEqual([]);
  });

  test("C7 flags a worker lacking every required position of the area", () => {
    const assignments = [assign("w1", "2026-01-05")];
    const w1 = worker("w1", "wa-a", ["pos-paint"]);
    const areaWorkers = { w1 };

    expect(
      validateRoster(assignments, areaWorkers, rules({ c7: true }), mkShift(3), {
        "wa-a": ["pos-weld", "pos-line"],
      }),
    ).toEqual([
      { rule: "C7", workerId: "w1", date: "2026-01-05", message: expect.any(String) },
    ]);
  });

  test("C7 skips areas with an empty requirement set", () => {
    const assignments = [
      assign("w1", "2026-01-05", "s0", "wa-a"),
      assign("w1", "2026-01-06", "s0", "wa-b"), // no positions, no requirement
    ];
    const areaWorkers = { w1: worker("w1", "wa-a", []) };

    expect(validateRoster(assignments, areaWorkers, rules({ c7: true }), mkShift(3), {
      "wa-a": [],
      "wa-b": [],
    })).toEqual([]);
  });

  test("C7 skips when disabled", () => {
    const assignments = [assign("w1", "2026-01-05")];
    const areaWorkers = { w1: worker("w1", "wa-a", ["pos-paint"]) };

    expect(
      validateRoster(assignments, areaWorkers, rules({ c7: false }), mkShift(3), {
        "wa-a": ["pos-weld"],
      }),
    ).toEqual([]);
  });

  test("a shiftDefId outside shiftOrder is flagged as an unknown shift", () => {
    const assignments = [
      assign("w1", "2026-01-05", "s9"),
      assign("w1", "2026-01-06", "s0"), // downshift numerically vs unknown s9 — but s9 must stay neutral
    ];

    expect(validateRoster(assignments, workers, rules(), mkShift(3), {})).toEqual([
      { rule: "C3", workerId: "w1", date: "2026-01-05", message: "unknown shift" },
    ]);
  });
});
