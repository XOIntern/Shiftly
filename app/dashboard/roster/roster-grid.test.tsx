import "dotenv/config";
import { describe, expect, mock, test } from "bun:test";

// The grid calls the Task 6 server actions from its cell handler; under
// bun test the actions module is swapped for a recording stub so the real
// "use server" module (and its DB client) never loads. The mutable holder
// lets each case script the result the action would return.
type ScriptedResult = unknown;
const setCalls: unknown[] = [];
let nextSetResult: ScriptedResult = { ok: true, data: { violations: [] } };
const reviseCalls: unknown[] = [];
let nextRevise: string | Error = "99999999-9999-4999-8999-999999999999";
mock.module("@/app/dashboard/roster/actions", () => ({
  setAssignment: async (input: unknown) => {
    setCalls.push(input);
    return nextSetResult;
  },
  generateRoster: async () => ({ ok: true }),
  publishRoster: async () => ({ ok: true }),
  ensureDraftVersion: async (planId: string) => {
    reviseCalls.push(planId);
    if (nextRevise instanceof Error) throw nextRevise;
    return nextRevise;
  },
  suggestReplacementsAction: async () => ({ ok: true, data: [] }),
  fillDailyRequest: async () => ({ ok: true }),
}));

const {
  assignmentKey,
  badgeText,
  commitPick,
  generateGateText,
  violationSummary,
  violationsByWorker,
} = await import("./roster-grid");
// The revise affordance lives in the week view (the grid stays draft-edit
// only); its pure wiring is tested here with the same mocks.
const { buildReviseHref, commitRevise } = await import("./roster-week-view");

const PLAN = "11111111-1111-4111-8111-111111111111";
const AREA = "22222222-2222-4222-9222-222222222222";
const W1 = "aaaaaaaa-1111-4111-8111-111111111111";
const W2 = "aaaaaaaa-2222-4222-9222-222222222222";
const SH1 = "dddddddd-1111-4111-8111-111111111111";
const MON = "2026-01-05";

describe("assignmentKey", () => {
  test("keys a cell by worker and date", () => {
    expect(assignmentKey(W1, MON)).toBe(`${W1}|${MON}`);
  });
});

describe("commitPick (the cell-click wiring into setAssignment)", () => {
  test("sends the picked cell's ids to setAssignment", async () => {
    setCalls.length = 0;
    nextSetResult = { ok: true, data: { violations: [] } };
    const outcome = await commitPick({
      planId: PLAN,
      workAreaId: AREA,
      workerId: W1,
      date: MON,
      shiftDefId: SH1,
    });
    expect(setCalls).toEqual([
      { planId: PLAN, workAreaId: AREA, workerId: W1, date: MON, shiftDefId: SH1 },
    ]);
    expect(outcome.ok).toBeTrue();
  });

  test("clearing a cell sends shiftDefId null without an area", async () => {
    setCalls.length = 0;
    nextSetResult = { ok: true, data: { violations: [] } };
    await commitPick({
      planId: PLAN,
      workAreaId: AREA,
      workerId: W1,
      date: MON,
      shiftDefId: null,
    });
    expect(setCalls[0]).toEqual({
      planId: PLAN,
      workerId: W1,
      date: MON,
      shiftDefId: null,
    });
  });

  test("the returned violations ride the outcome as row badges", async () => {
    setCalls.length = 0;
    nextSetResult = {
      ok: true,
      data: {
        violations: [
          { rule: "C1", workerId: W1, date: MON, message: "over the weekly limit" },
        ],
      },
    };
    const outcome = await commitPick({
      planId: PLAN,
      workAreaId: AREA,
      workerId: W1,
      date: MON,
      shiftDefId: SH1,
    });
    expect(outcome.ok).toBeTrue();
    expect(outcome.violations?.length).toBe(1);
    const byWorker = violationsByWorker(outcome.violations ?? []);
    expect(byWorker[W1]?.map(badgeText)).toEqual(["C1 · over the weekly limit"]);
    expect(byWorker[W2]).toBeUndefined();
  });

  test("an action refusal keeps its message (the race envelope)", async () => {
    setCalls.length = 0;
    nextSetResult = {
      ok: false,
      message: "Plan was published while editing, retry",
    };
    const outcome = await commitPick({
      planId: PLAN,
      workAreaId: AREA,
      workerId: W1,
      date: MON,
      shiftDefId: SH1,
    });
    expect(outcome.ok).toBeFalse();
    expect(outcome.message).toBe("Plan was published while editing, retry");
  });
});

describe("violationsByWorker / badgeText / violationSummary", () => {
  test("groups violations onto their worker and skips the others' rows", () => {
    const byWorker = violationsByWorker([
      { rule: "C2", workerId: W1, message: "double shift" },
      { rule: "C3", workerId: W2, date: MON, message: "unknown shift" },
    ]);
    expect(byWorker[W1]?.map((v) => v.rule)).toEqual(["C2"]);
    expect(byWorker[W2]?.map((v) => v.rule)).toEqual(["C3"]);
  });

  test("badge text leads with the rule key", () => {
    expect(badgeText({ rule: "C5", workerId: W1, message: "no rest day" })).toBe(
      "C5 · no rest day",
    );
  });

  test("the plan summary line counts and quotes the first violations", () => {
    const summary = violationSummary([
      { rule: "C1", workerId: W1, message: "one" },
      { rule: "C2", workerId: W2, message: "two" },
      { rule: "C3", workerId: W1, message: "three" },
    ]);
    expect(summary).toBe("3 rule warnings — C1 · one; C2 · two; C3 · three");
    expect(violationSummary([])).toBeNull();
  });
});

describe("generateGateText (the disabled generate explanation)", () => {
  test("an empty requirement week explains what is missing", () => {
    expect(generateGateText(0)).toBe("No received requests cover this week.");
  });

  test("a covered week gates nothing", () => {
    expect(generateGateText(3)).toBeNull();
  });
});

const PUBLISHED = "55555555-5555-4555-8555-555555555555";
const NEXT_DRAFT = "99999999-9999-4999-8999-999999999999";

describe("commitRevise (the Revise plan wiring into ensureDraftVersion)", () => {
  test("sends the published plan's id and resolves to the new draft id", async () => {
    reviseCalls.length = 0;
    nextRevise = NEXT_DRAFT;
    const outcome = await commitRevise(PUBLISHED);
    expect(reviseCalls).toEqual([PUBLISHED]);
    expect(outcome).toEqual({ ok: true, draftPlanId: NEXT_DRAFT });
  });

  test("a thrown refusal becomes an error outcome (toast path)", async () => {
    reviseCalls.length = 0;
    nextRevise = new Error("Roster not found.");
    const outcome = await commitRevise(PUBLISHED);
    expect(reviseCalls).toEqual([PUBLISHED]);
    expect(outcome.ok).toBeFalse();
    expect((outcome as { message: string }).message.length).toBeGreaterThan(0);
    nextRevise = NEXT_DRAFT;
  });
});

describe("buildReviseHref (the navigation to the returned draft)", () => {
  test("switches planId to the returned draft, preserving week and workAreaId", () => {
    const href = buildReviseHref(
      `week=2026-01-05&planId=${PUBLISHED}&workAreaId=22222222-2222-4222-9222-222222222222`,
      NEXT_DRAFT,
    );
    const params = new URLSearchParams(href);
    expect(params.get("planId")).toBe(NEXT_DRAFT);
    expect(params.get("week")).toBe("2026-01-05");
    expect(params.get("workAreaId")).toBe(
      "22222222-2222-4222-9222-222222222222",
    );
  });
});
