import { describe, expect, test } from "bun:test";

import type { Violation } from "./engine/validate";
import { splitViolationsByHorizon } from "./roster-plan-mutations";

const violation = (date: string | undefined, workerId = "w1"): Violation => ({
  rule: "C1",
  workerId,
  date,
  message: `m-${date ?? "undated"}`,
});

const weeklyPlan = {
  kind: "weekly" as const,
  weekStart: "2026-01-05",
  requestDate: null,
};

describe("splitViolationsByHorizon", () => {
  test("splitViolationsByHorizon puts violations dated inside the plan week in blocking and earlier-dated ones in historical", () => {
    const inside = violation("2026-01-07");
    const firstDay = violation("2026-01-05");
    const lastDay = violation("2026-01-11");
    const earlier = violation("2026-01-04");

    const { blocking, historical } = splitViolationsByHorizon(
      [inside, earlier, firstDay, lastDay],
      weeklyPlan,
    );

    expect(blocking).toEqual([inside, firstDay, lastDay]);
    expect(historical).toEqual([earlier]);
  });

  test("a daily plan's horizon is the week of its request date", () => {
    const inside = violation("2026-01-08");
    const earlier = violation("2026-01-02");

    const { blocking, historical } = splitViolationsByHorizon(
      [inside, earlier],
      { kind: "daily", weekStart: null, requestDate: "2026-01-07" },
    );

    expect(blocking).toEqual([inside]);
    expect(historical).toEqual([earlier]);
  });

  test("undated violations are blocking", () => {
    const undated = violation(undefined);

    const { blocking, historical } = splitViolationsByHorizon(
      [undated],
      weeklyPlan,
    );

    expect(blocking).toEqual([undated]);
    expect(historical).toEqual([]);
  });
});
