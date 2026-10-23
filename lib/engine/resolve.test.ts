import { describe, expect, test } from "bun:test";

import { DEFAULT_RULES } from "@/types/engine";
import { resolveRules } from "./resolve";
import type { RuleConfigRow } from "@/types/domain";

// Task 2 of the config-rules epic (GitHub #49): the pure resolver that turns
// global / site / location config rows into effective rules C1–C7, each
// carrying the scope it came from. No DB, no Next — plain data in, plain
// data out.
const intRow = (ruleKey: RuleConfigRow["ruleKey"], value: number): RuleConfigRow => ({
  ruleKey,
  intValue: value,
  boolValue: null,
});

const boolRow = (ruleKey: RuleConfigRow["ruleKey"], value: boolean): RuleConfigRow => ({
  ruleKey,
  intValue: null,
  boolValue: value,
});

describe("resolveRules (issue #49 task 2)", () => {
  test("falls back to built-in defaults when no global row exists", () => {
    expect(resolveRules([], [], [])).toEqual(DEFAULT_RULES);
  });

  test("global rows override defaults with source 'global'", () => {
    const rules = resolveRules([intRow("C1", 4), boolRow("C3", false)], [], []);

    expect(rules.c1).toEqual({ value: 4, source: "global" });
    expect(rules.c3).toEqual({ value: false, source: "global" });
    // Rules without a row keep their built-in defaults.
    expect(rules.c2).toEqual(DEFAULT_RULES.c2);
    expect(rules.c7).toEqual(DEFAULT_RULES.c7);
  });

  test("a site override beats global (C1 site 6 → {6,'site'}; C2 stays {20,'global'})", () => {
    const rules = resolveRules(
      [intRow("C1", 5), intRow("C2", 20)],
      [intRow("C1", 6)],
      [],
    );

    expect(rules.c1).toEqual({ value: 6, source: "site" });
    expect(rules.c2).toEqual({ value: 20, source: "global" });
  });

  test("a location override beats its site override", () => {
    const rules = resolveRules([], [intRow("C1", 6)], [intRow("C1", 7)]);

    expect(rules.c1).toEqual({ value: 7, source: "location" });
  });

  test("partial overrides inherit per rule", () => {
    const rules = resolveRules(
      [intRow("C1", 4), intRow("C5", 45)],
      [intRow("C5", 50)],
      [intRow("C2", 18)],
    );

    expect(rules.c1).toEqual({ value: 4, source: "global" });
    expect(rules.c2).toEqual({ value: 18, source: "location" });
    expect(rules.c5).toEqual({ value: 50, source: "site" });
    expect(rules.c3).toEqual(DEFAULT_RULES.c3);
    expect(rules.c4).toEqual(DEFAULT_RULES.c4);
    expect(rules.c6).toEqual(DEFAULT_RULES.c6);
    expect(rules.c7).toEqual(DEFAULT_RULES.c7);
  });

  test("a row without a matching value column is treated as absent", () => {
    const rules = resolveRules(
      [
        // C1 is an int rule: a row carrying only a bool value is ignored.
        { ruleKey: "C1", intValue: null, boolValue: true },
        // C3 is a bool rule: a row carrying only an int value is ignored.
        { ruleKey: "C3", intValue: 9, boolValue: null },
      ],
      [],
      [],
    );

    expect(rules.c1).toEqual(DEFAULT_RULES.c1);
    expect(rules.c3).toEqual(DEFAULT_RULES.c3);
  });

  test("C7 resolves through the same chain (global row wins, location beats site, default on absence)", () => {
    expect(resolveRules([boolRow("C7", false)], [], []).c7).toEqual({
      value: false,
      source: "global",
    });
    expect(resolveRules([], [boolRow("C7", true)], [boolRow("C7", false)]).c7).toEqual({
      value: false,
      source: "location",
    });
    expect(resolveRules([], [], []).c7).toEqual({ value: true, source: "default" });
  });

  test("a stale C8 row is ignored — the rule set is C1–C7 now", () => {
    // The migrated DB enum carries C1–C7 only, so no C8 row can exist; forge
    // one anyway (pre-migration shape) to prove it leaks into nothing.
    const staleC8Row = {
      ruleKey: "C8",
      intValue: null,
      boolValue: false,
    } as unknown as RuleConfigRow;

    expect(resolveRules([staleC8Row], [], [])).toEqual(DEFAULT_RULES);
  });

  test("EffectiveRules survives a JSON round-trip unchanged", () => {
    const rules = resolveRules(
      [intRow("C1", 4)],
      [intRow("C1", 6), boolRow("C3", false)],
      [intRow("C1", 7)],
    );

    expect(JSON.parse(JSON.stringify(rules))).toEqual(rules);
  });
});
