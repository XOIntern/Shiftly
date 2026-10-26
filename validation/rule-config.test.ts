import { describe, expect, test } from "bun:test";

import { ruleConfigSchema } from "./rule-config";

// Task 5 of the config-rules epic (GitHub #52): the value ranges the HO
// settings form enforces before a write reaches upsertRuleRow. Pure zod —
// no DB. The factory takes the C5 value effective at the write's scope
// (injected by the action, which resolves it from the config loaders).
const schema = ruleConfigSchema(60);

describe("ruleConfigSchema value ranges (issue #52)", () => {
  test("accepts the boundary and mid-range values per rule", () => {
    for (const intValue of [1, 3, 7]) {
      expect(
        schema.safeParse({
          ruleKey: "C1",
          scope: "global",
          intValue,
          boolValue: null,
        }).success,
      ).toBe(true);
    }
    for (const intValue of [1, 15, 31]) {
      expect(
        schema.safeParse({
          ruleKey: "C2",
          scope: "global",
          intValue,
          boolValue: null,
        }).success,
      ).toBe(true);
    }
    for (const intValue of [1, 60, 365]) {
      expect(
        schema.safeParse({
          ruleKey: "C5",
          scope: "global",
          intValue,
          boolValue: null,
        }).success,
      ).toBe(true);
    }
    // Against an effective C5 of 60, any sane C6 passes the pair refine.
    for (const intValue of [1, 4, 60]) {
      expect(
        schema.safeParse({
          ruleKey: "C6",
          scope: "global",
          intValue,
          boolValue: null,
        }).success,
      ).toBe(true);
    }
  });

  test("rejects out-of-range and non-integer values with an intValue error", () => {
    for (const [ruleKey, bad] of [
      ["C1", 0],
      ["C1", 8],
      ["C1", 2.5],
      ["C2", 0],
      ["C2", 32],
      ["C2", 3.5],
      ["C5", 0],
      ["C5", -1],
      ["C6", 0],
      ["C6", -2],
    ] as const) {
      const result = schema.safeParse({
        ruleKey,
        scope: "global",
        intValue: bad,
        boolValue: null,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.includes("intValue")),
        ).toBe(true);
      }
    }
  });

  test("C6 must not exceed the effective C5 (field error on intValue)", () => {
    const tight = ruleConfigSchema(3);
    const rejected = tight.safeParse({
      ruleKey: "C6",
      scope: "site",
      intValue: 5,
      boolValue: null,
    });
    expect(rejected.success).toBe(false);
    if (!rejected.success) {
      expect(rejected.error.issues[0].path).toContain("intValue");
    }
    expect(
      tight.safeParse({
        ruleKey: "C6",
        scope: "site",
        intValue: 3,
        boolValue: null,
      }).success,
    ).toBe(true);
  });

  test("bool rules reject an intValue and int rules reject a boolValue", () => {
    for (const ruleKey of ["C3", "C4", "C7"] as const) {
      expect(
        schema.safeParse({
          ruleKey,
          scope: "global",
          intValue: 5,
          boolValue: null,
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ruleKey,
          scope: "global",
          intValue: null,
          boolValue: true,
        }).success,
      ).toBe(true);
    }
    for (const ruleKey of ["C1", "C2", "C5", "C6"] as const) {
      expect(
        schema.safeParse({
          ruleKey,
          scope: "global",
          intValue: null,
          boolValue: true,
        }).success,
      ).toBe(false);
    }
  });

  test("a stale C8 payload fails on the ruleKey field (invalid enum value)", () => {
    // The rule set is C1–C7 now, so a stale client writing C8 must get a
    // field error on ruleKey — not a DB error or a crash.
    const result = schema.safeParse({
      ruleKey: "C8",
      scope: "global",
      intValue: null,
      boolValue: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Only the enum issue: the refines never run, so the field error is
      // the whole response.
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toContain("ruleKey");
      // zod v4 wording for an invalid enum value.
      expect(result.error.issues[0].message).toContain("Invalid option");
    }
  });

  test("rejects an unknown rule key and a bad scope", () => {
    expect(
      schema.safeParse({
        ruleKey: "C9",
        scope: "global",
        intValue: 1,
        boolValue: null,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ruleKey: "C1",
        scope: "world",
        intValue: 1,
        boolValue: null,
      }).success,
    ).toBe(false);
  });
});
