import { describe, expect, test } from "bun:test";

import { DEFAULT_RULES } from "./types";
import type { EffectiveRule, EffectiveRules } from "@/types/engine";
import { resolveRules } from "./resolve";
import type { RuleConfigRow } from "@/types/domain";
import { validateRoster, type RosterAssignment, type Shift, type WorkerProfile } from "./validate";

// Task 3 of the config-rules epic (GitHub #50): the pure validator over a
// draft roster. Rules C1–C7 are evaluated against the effective rules the
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

const assign = (
  workerId: string,
  date: string,
  shift: Shift = 1,
  workAreaId = "wa-a",
): RosterAssignment => ({ workerId, date, shift, workAreaId });

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
};

const consecutive = (start: string, count: number, shift: Shift = 1): RosterAssignment[] =>
  Array.from({ length: count }, (_, i) => assign("w1", addDays(start, i), shift));

const workers: Record<string, WorkerProfile> = { w1: { workAreaId: "wa-a" } };

const intRow = (ruleKey: RuleConfigRow["ruleKey"], value: number): RuleConfigRow => ({
  ruleKey,
  intValue: value,
  boolValue: null,
});

describe("validateRoster (issue #50 task 3)", () => {
  test("C1 flags the 6th work day in a week under defaults", () => {
    const assignments = consecutive("2026-01-05", 6); // Mon–Sat of the Mon-start week

    expect(validateRoster(assignments, workers, rules())).toEqual([
      { rule: "C1", workerId: "w1", date: "2026-01-10", message: expect.any(String) },
    ]);
  });

  test("C1 weeks start Monday: a Sunday assignment belongs to the previous week", () => {
    // Sun 01-04 .. Fri 01-09 is 6 consecutive work days; only under a
    // Monday-start week (01-04 in the prior week) do they stay within c1 = 5.
    const assignments = consecutive("2026-01-04", 6);

    expect(validateRoster(assignments, workers, rules())).toEqual([]);
  });

  test("C1 accepts 6 work days when the site resolves c1 = 6", () => {
    const siteRules = resolveRules([intRow("C1", 5)], [intRow("C1", 6)], []);
    const assignments = consecutive("2026-01-05", 6);

    expect(validateRoster(assignments, workers, siteRules)).toEqual([]);
  });

  test("C2 flags the 21st work day in a month", () => {
    const assignments = consecutive("2026-03-01", 21);

    expect(validateRoster(assignments, workers, rules({ c1: 7 }))).toEqual([
      { rule: "C2", workerId: "w1", date: "2026-03-21", message: expect.any(String) },
    ]);
  });

  test("C3 flags downshift 2→1 on the later day", () => {
    const assignments = [assign("w1", "2026-01-05", 2), assign("w1", "2026-01-06", 1)];

    expect(validateRoster(assignments, workers, rules())).toEqual([
      { rule: "C3", workerId: "w1", date: "2026-01-06", message: expect.any(String) },
    ]);
  });

  test("C3 accepts forward rotation 1→2→3", () => {
    const assignments = [
      assign("w1", "2026-01-05", 1),
      assign("w1", "2026-01-06", 2),
      assign("w1", "2026-01-07", 3),
    ];

    expect(validateRoster(assignments, workers, rules())).toEqual([]);
  });

  test("C3 skips when disabled", () => {
    const assignments = [assign("w1", "2026-01-05", 2), assign("w1", "2026-01-06", 1)];

    expect(validateRoster(assignments, workers, rules({ c3: false }))).toEqual([]);
  });

  test("C3 compares consecutive days only, not across a rest day", () => {
    const assignments = [
      assign("w1", "2026-01-05", 2),
      assign("w1", "2026-01-07", 1), // 01-06 rested; rotation resets
    ];

    expect(validateRoster(assignments, workers, rules())).toEqual([]);
  });

  test("C4 flags work the day after a shift-3 day", () => {
    const assignments = [assign("w1", "2026-01-05", 3), assign("w1", "2026-01-06", 3)];

    expect(validateRoster(assignments, workers, rules())).toEqual([
      { rule: "C4", workerId: "w1", date: "2026-01-06", message: expect.any(String) },
    ]);
  });

  test("C4 accepts a rest day after shift 3", () => {
    const assignments = [assign("w1", "2026-01-05", 3)];

    expect(validateRoster(assignments, workers, rules())).toEqual([]);
  });

  test("C4 skips when disabled", () => {
    const assignments = [assign("w1", "2026-01-05", 3), assign("w1", "2026-01-06", 3)];

    expect(validateRoster(assignments, workers, rules({ c4: false }))).toEqual([]);
  });

  test("C5 flags an assigned day inside the owed break", () => {
    const assignments = consecutive("2026-01-05", 6); // c5=5 work days, then the 1st owed break day

    expect(validateRoster(assignments, workers, rules({ c1: 7, c5: 5, c6: 2 }))).toEqual([
      { rule: "C5", workerId: "w1", date: "2026-01-10", message: expect.any(String) },
    ]);
  });

  test("C5 accepts a full break taken", () => {
    const assignments = [
      ...consecutive("2026-01-05", 5), // Mon–Fri reaches c5 = 5
      assign("w1", "2026-01-12"), // resumes after the 2-day owed break (01-10, 01-11)
    ];

    expect(validateRoster(assignments, workers, rules({ c1: 7, c5: 5, c6: 2 }))).toEqual([]);
  });

  test("C5 does not flag a break owed past the horizon", () => {
    const assignments = consecutive("2026-01-05", 5); // roster ends the day the break becomes owed

    expect(validateRoster(assignments, workers, rules({ c1: 7, c5: 5, c6: 2 }))).toEqual([]);
  });

  test("C7 stays dormant while qualification data is not modeled", () => {
    // C7 is enabled but dormant: no worker qualifications or work-area
    // requirements exist to compare yet, so it flags nothing.
    const assignments = [assign("w1", "2026-01-05")];

    expect(validateRoster(assignments, workers, rules({ c7: true }))).toEqual([]);
  });

  test("C7 skips when disabled", () => {
    const assignments = [assign("w1", "2026-01-05")];

    expect(validateRoster(assignments, workers, rules({ c7: false }))).toEqual([]);
  });
});
