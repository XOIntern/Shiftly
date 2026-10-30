import { describe, expect, test } from "bun:test";

import { DEFAULT_RULES } from "@/types/engine";
import type {
  EffectiveRule,
  EffectiveRules,
  RosterAssignment,
} from "@/types/engine";
import { dayFromNumber, dayNumber } from "../dates";
import { generateDraft } from "./generate";
import type { RequirementLine } from "./generate";
import { validateRoster } from "./validate";

// Task 2 of the roster-engine plan: the deterministic draft generator.
// No randomness anywhere in the engine — sortKey tie-breaks make two runs
// byte-equal (the seeded PRNG here exists only to build the property-suite
// fixture). No DB, no Next, no clock: everything enters via parameters.

const addDays = (date: string, n: number): string =>
  dayFromNumber(dayNumber(date) + n);

type Override = Partial<Record<"c1" | "c2" | "c5" | "c6", number>> &
  Partial<Record<"c3" | "c4" | "c7", boolean>>;

const rule = <T extends number | boolean>(
  value: T | undefined,
  fallback: EffectiveRule<T>,
): EffectiveRule<T> =>
  value === undefined ? fallback : { value, source: "site" };

const rules = (over: Override = {}): EffectiveRules => ({
  c1: rule(over.c1, DEFAULT_RULES.c1),
  c2: rule(over.c2, DEFAULT_RULES.c2),
  c3: rule(over.c3, DEFAULT_RULES.c3),
  c4: rule(over.c4, DEFAULT_RULES.c4),
  c5: rule(over.c5, DEFAULT_RULES.c5),
  c6: rule(over.c6, DEFAULT_RULES.c6),
  c7: rule(over.c7, DEFAULT_RULES.c7),
});

const assign = (
  workerId: string,
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
): RosterAssignment => ({ workerId, date, shiftDefId, workAreaId });

const mkShift = (order: number): string[] =>
  Array.from({ length: order }, (_, i) => `s${i}`);

const mkWorker = (
  id: string,
  workAreaId = "wa-a",
  positionIds: readonly string[] = [],
  employeeId?: string,
) => ({ id, employeeId: employeeId ?? id, workAreaId, positionIds });

const line = (
  date: string,
  shiftDefId = "s0",
  workAreaId = "wa-a",
  headcount = 1,
  positionId = "pos-a",
): RequirementLine => ({ workAreaId, shiftDefId, date, headcount, positionId });

describe("generateDraft (roster-engine task 2)", () => {
  test("two runs on identical input are byte-equal (deterministic)", () => {
    const input = {
      requirements: [line("2026-01-05"), line("2026-01-06")],
      workers: [mkWorker("w1", "wa-a", ["pos-a"]), mkWorker("w2", "wa-a", ["pos-a"])],
      shiftOrder: mkShift(3),
      areaRequirements: {},
      priorAssignments: [],
      rules: rules(),
    };

    const a = generateDraft(input);
    const b = generateDraft(input);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("greedy picks the least-loaded worker (smaller week count wins)", () => {
    // w1 has 4 work days in the target week, w2 only 2.
    const result = generateDraft({
      requirements: [line("2026-01-09")],
      workers: [mkWorker("w1", "wa-a", ["pos-a"]), mkWorker("w2", "wa-a", ["pos-a"])],
      shiftOrder: mkShift(3),
      areaRequirements: {},
      priorAssignments: [
        assign("w1", "2026-01-05"),
        assign("w1", "2026-01-06"),
        assign("w1", "2026-01-07"),
        assign("w1", "2026-01-08"),
        assign("w2", "2026-01-07"),
      ],
      rules: rules(),
    });

    expect(result.assignments.map((a) => a.workerId)).toEqual(["w2"]);
    expect(result.deficits).toEqual([]);
  });

  test("C3 forces the second pick to a different worker", () => {
    // Tie on load (both have one prior same-week shift), employeeId breaks
    // the tie toward w1 — but w1 held the higher shift s1 and the line asks
    // for s0 on the next day: a downshift, rejected by C3. w2 (s0 → s0, no
    // downshift) is admitted instead.
    const result = generateDraft({
      requirements: [line("2026-01-06")],
      workers: [mkWorker("w1", "wa-a", ["pos-a"]), mkWorker("w2", "wa-a", ["pos-a"])],
      shiftOrder: mkShift(3),
      areaRequirements: {},
      priorAssignments: [
        assign("w1", "2026-01-05", "s1"),
        assign("w2", "2026-01-05", "s0"),
      ],
      rules: rules(),
    });

    expect(result.assignments.map((a) => a.workerId)).toEqual(["w2"]);

    // With C3 off the tie-break wins instead: w1 gets the slot.
    const noRotation = generateDraft({
      requirements: [line("2026-01-06")],
      workers: [mkWorker("w1", "wa-a", ["pos-a"]), mkWorker("w2", "wa-a", ["pos-a"])],
      shiftOrder: mkShift(3),
      areaRequirements: {},
      priorAssignments: [
        assign("w1", "2026-01-05", "s1"),
        assign("w2", "2026-01-05", "s0"),
      ],
      rules: rules({ c3: false }),
    });

    expect(noRotation.assignments.map((a) => a.workerId)).toEqual(["w1"]);
  });

  test("C7 requirement filters candidates → deficit no_qualified_candidate when none", () => {
    const result = generateDraft({
      requirements: [line("2026-01-05", "s0", "wa-a", 2, "pos-weld")],
      workers: [
        mkWorker("w1", "wa-a", ["pos-paint"]),
        mkWorker("w2", "wa-a", ["pos-weld"]),
      ],
      shiftOrder: mkShift(3),
      areaRequirements: { "wa-a": ["pos-weld"] },
      priorAssignments: [],
      rules: rules({ c7: true }),
    });

    expect(result.assignments.map((a) => a.workerId)).toEqual(["w2"]);
    expect(result.deficits).toEqual([
      {
        workAreaId: "wa-a",
        shiftDefId: "s0",
        date: "2026-01-05",
        missing: 1,
        reason: "no_qualified_candidate",
      },
    ]);
  });

  test("all candidates rejected by non-qualification rules → all_rule_limited", () => {
    // Every worker is at the 5-day week limit: Saturday would be the 6th.
    const result = generateDraft({
      requirements: [line("2026-01-10", "s0", "wa-a")],
      workers: [mkWorker("w1", "wa-a", ["pos-a"]), mkWorker("w2", "wa-a", ["pos-a"])],
      shiftOrder: mkShift(3),
      areaRequirements: {},
      priorAssignments: [
        ...[
          "2026-01-05",
          "2026-01-06",
          "2026-01-07",
          "2026-01-08",
          "2026-01-09",
        ].map((d) => assign("w1", d)),
        ...[
          "2026-01-05",
          "2026-01-06",
          "2026-01-07",
          "2026-01-08",
          "2026-01-09",
        ].map((d) => assign("w2", d)),
      ],
      rules: rules(),
    });

    expect(result.assignments).toEqual([]);
    expect(result.deficits).toEqual([
      {
        workAreaId: "wa-a",
        shiftDefId: "s0",
        date: "2026-01-10",
        missing: 1,
        reason: "all_rule_limited",
      },
    ]);
  });

  test("respects priorAssignments ordering and leaves fuzzy history in place", () => {
    const prior: RosterAssignment[] = [assign("w1", "2026-01-05")];
    const result = generateDraft({
      requirements: [line("2026-01-07"), line("2026-01-06")],
      workers: [mkWorker("w1", "wa-a", ["pos-a"]), mkWorker("w2", "wa-a", ["pos-a"])],
      shiftOrder: mkShift(3),
      areaRequirements: {},
      priorAssignments: prior,
      rules: rules(),
    });

    expect(prior).toEqual([assign("w1", "2026-01-05")]); // input not mutated
    // w1 has fresher seniority, w2 takes 01-06; w1 takes 01-07.
    expect(result.assignments.map((a) => a.workerId)).toEqual(["w2", "w1"]);
  });

  test("full-load property: 7 areas × 200 workers × 12 weeks, C1=5 → validator clean, coverage ≥95%, fairness ≤2", () => {
    // Seeded LCG — the ONLY randomness in the whole suite, and it lives in
    // the fixture builder, never in the engine.
    let seed = 20261022;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

    const areaCount = 7;
    const areas = Array.from({ length: areaCount }, (_, i) => `wa-${i}`);
    const shiftOrder = mkShift(3);
    const workerCount = 200;

    const workers = Array.from({ length: workerCount }, (_, i) => {
      const area = areas[i % areaCount];
      // Mostly qualified for their home area; some also extra positions.
      const positions = [`pos-${area}`];
      if (rand() < 0.25)
        positions.push(
          `pos-${areas[Math.floor(rand() * areaCount) === i % areaCount ? (i + 1) % areaCount : i % areaCount]}`,
        );
      return mkWorker(
        `w${i}`,
        area,
        positions,
        `e${String(i).padStart(4, "0")}`,
      );
    });

    const areaRequirements: Record<string, readonly string[]> = {};
    for (const area of areas) areaRequirements[area] = [`pos-${area}`];

    // 12 Monday-start weeks of demand: every area, every day, 2 slots on s0.
    const start = "2026-03-02";
    const requirements = Array.from({ length: 12 * 7 }, (_, d) =>
      areas.map((area) => line(addDays(start, d), "s0", area, 2, `pos-${area}`)),
    ).flat();

    const priorAssignments: RosterAssignment[] = [];
    const effective = rules();

    const result = generateDraft({
      requirements,
      workers,
      shiftOrder,
      areaRequirements,
      priorAssignments,
      rules: effective,
    });

    // 1. The generated roster validates clean against the same rules.
    const workersRecord = Object.fromEntries(
      workers.map((w) => [w.id, w] as const),
    );
    expect(
      validateRoster(
        result.assignments,
        workersRecord,
        effective,
        shiftOrder,
        areaRequirements,
      ),
    ).toEqual([]);

    // 2. Deficit coverage ≥ 95%.
    const total = requirements.reduce((sum, l) => sum + l.headcount, 0);
    const missing = result.deficits.reduce((sum, d) => sum + d.missing, 0);
    expect(missing / total).toBeLessThanOrEqual(0.05);

    // 3. Fairness: max−min monthly work days within every area ≤ 2.
    const monthAreaWorker = new Map<string, number>();
    for (const a of result.assignments) {
      const key = `${a.workAreaId}|${a.date.slice(0, 7)}|${a.workerId}`;
      monthAreaWorker.set(key, (monthAreaWorker.get(key) ?? 0) + 1);
    }
    const areaMonth = new Map<string, number[]>();
    for (const [key, count] of monthAreaWorker) {
      const [area] = key.split("|");
      const list = areaMonth.get(area) ?? [];
      list.push(count);
      areaMonth.set(area, list);
    }
    expect(areaMonth.size).toBe(areaCount);
    for (const counts of areaMonth.values()) {
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    }
  });

  test("performance budget: 1,400-worker input completes under 5,000 ms", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

    const areas = Array.from({ length: 7 }, (_, i) => `wa-${i}`);
    const shiftOrder = mkShift(3);
    const workers = Array.from({ length: 1400 }, (_, i) => {
      const area = areas[i % 7];
      const positions = rand() < 0.15 ? [] : [`pos-${area}`];
      return mkWorker(`w${i}`, area, positions, `e${i}`);
    });

    const areaRequirements: Record<string, readonly string[]> = {};
    for (const area of areas) areaRequirements[area] = [`pos-${area}`];

    const start = "2026-03-02";
    const requirements = Array.from({ length: 12 * 7 }, (_, d) =>
      areas.flatMap((area) => [
        line(addDays(start, d), "s0", area, 3, `pos-${area}`),
        line(addDays(start, d), "s1", area, 3, `pos-${area}`),
      ]),
    ).flat();

    const t0 = performance.now();
    const result = generateDraft({
      requirements,
      workers,
      shiftOrder,
      areaRequirements,
      priorAssignments: [],
      rules: rules(),
    });
    const elapsed = performance.now() - t0;

    expect(result.assignments.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000);
  });

  test("capability-derived pairs: one worker eligible for two areas validates clean across both (union profile)", () => {
    // The loaders emit one pair per (worker, eligible area). The per-worker
    // profile handed to the validator must carry the UNION of the pair
    // positionIds — otherwise C7 rejects the area whose requirement only
    // matches the other pair's slice.
    const result = generateDraft({
      requirements: [
        line("2026-01-05", "s0", "wa-a", 1, "pos-a"),
        line("2026-01-06", "s0", "wa-b", 1, "pos-b"),
      ],
      workers: [
        mkWorker("w1", "wa-a", ["pos-a"]),
        mkWorker("w1", "wa-b", ["pos-b"]),
      ],
      shiftOrder: mkShift(3),
      areaRequirements: { "wa-a": ["pos-a"], "wa-b": ["pos-b"] },
      priorAssignments: [],
      rules: rules({ c7: true }),
    });

    expect(result.deficits).toEqual([]);
    expect(result.assignments).toEqual([
      assign("w1", "2026-01-05", "s0", "wa-a"),
      assign("w1", "2026-01-06", "s0", "wa-b"),
    ]);
    // The union profile validates clean on every filled row.
    expect(
      validateRoster(
        result.assignments,
        { w1: { workAreaId: "wa-a", positionIds: ["pos-a", "pos-b"] } },
        rules({ c7: true }),
        mkShift(3),
        { "wa-a": ["pos-a"], "wa-b": ["pos-b"] },
      ),
    ).toEqual([]);
  });

  test("the candidate pool demands the line's exact position (#143)", () => {
    // Two same-area workers: A holds p1, B holds p2. The line demands p2 —
    // exact-position matching, sharper than C7's any-required-position —
    // so only B is assignable.
    const result = generateDraft({
      requirements: [line("2026-01-05", "s0", "wa-a", 1, "pos-p2")],
      workers: [
        mkWorker("w-a", "wa-a", ["pos-p1"]),
        mkWorker("w-b", "wa-a", ["pos-p2"]),
      ],
      shiftOrder: mkShift(3),
      areaRequirements: { "wa-a": ["pos-p1", "pos-p2"] },
      priorAssignments: [],
      rules: rules({ c7: true }),
    });

    expect(result.assignments.map((a) => a.workerId)).toEqual(["w-b"]);
    expect(result.deficits).toEqual([]);
  });

  test("nobody holds the demanded position → no_qualified_candidate with full missing", () => {
    const result = generateDraft({
      requirements: [line("2026-01-05", "s0", "wa-a", 2, "pos-p3")],
      workers: [
        mkWorker("w-a", "wa-a", ["pos-p1"]),
        mkWorker("w-b", "wa-a", ["pos-p2"]),
      ],
      shiftOrder: mkShift(3),
      areaRequirements: { "wa-a": ["pos-p1", "pos-p2"] },
      priorAssignments: [],
      rules: rules({ c7: true }),
    });

    expect(result.assignments).toEqual([]);
    expect(result.deficits).toEqual([
      {
        workAreaId: "wa-a",
        shiftDefId: "s0",
        date: "2026-01-05",
        missing: 2,
        reason: "no_qualified_candidate",
      },
    ]);
  });

  // #250: a history row that already breaks a rule (e.g. a daily fill kept
  // after the location tightened C1) must not keep its worker out of days the
  // violation has nothing to do with; only a candidate that ADDS a violation
  // is refused.
  describe("a worker whose history already breaks a rule (#250)", () => {
    // Mon-Wed worked under C1 = 2: the third day is already a C1 violation.
    const overLimit = [
      assign("w1", "2026-01-05"),
      assign("w1", "2026-01-06"),
      assign("w1", "2026-01-07"),
    ];
    const input = (date: string) => ({
      requirements: [line(date, "s0", "wa-a", 1)],
      workers: [mkWorker("w1", "wa-a", ["pos-a"])],
      shiftOrder: mkShift(3),
      areaRequirements: {},
      priorAssignments: overLimit,
      rules: rules({ c1: 2 }),
    });

    test("is still scheduled on a day outside the violating week", () => {
      const result = generateDraft(input("2026-01-12"));

      expect(result.assignments.map((a) => a.workerId)).toEqual(["w1"]);
      expect(result.deficits).toEqual([]);
    });

    test("is still refused on a day that adds to the violation", () => {
      const result = generateDraft(input("2026-01-08"));

      expect(result.assignments).toEqual([]);
      expect(result.deficits).toEqual([
        {
          workAreaId: "wa-a",
          shiftDefId: "s0",
          date: "2026-01-08",
          missing: 1,
          reason: "all_rule_limited",
        },
      ]);
    });
  });
});
