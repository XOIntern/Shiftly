import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetAssignmentResult } from "@/app/dashboard/roster/actions";

// commitPick and commitRevise take the server action as an injectable
// argument, so the wiring cases below pass recording stubs instead of
// swapping the real actions module (a process-wide mock would leak into
// every other suite that imports it).
const setCalls: unknown[] = [];
let nextSetResult: unknown = { ok: true, data: { violations: [] } };
const recordSet = async (input: unknown) => {
  setCalls.push(input);
  return nextSetResult as SetAssignmentResult;
};
const reviseCalls: unknown[] = [];
let nextRevise: string | Error = "99999999-9999-4999-8999-999999999999";
const recordRevise = async (planId: string) => {
  reviseCalls.push(planId);
  if (nextRevise instanceof Error) throw nextRevise;
  return { ok: true as const, draftPlanId: nextRevise };
};

const {
  RosterGrid,
  assignmentKey,
  badgeText,
  commitPick,
  violationSummary,
  violationsByWorker,
} = await import("./roster-grid");
// The revise affordance lives in the week view (the grid stays draft-edit
// only); its pure wiring is tested here with the same mocks.
const { buildReviseHref, commitRevise, shouldRefreshAfterRevise } = await import(
  "./roster-week-view"
);

const PLAN = "11111111-1111-4111-8111-111111111111";
const AREA = "22222222-2222-4222-9222-222222222222";
const W1 = "aaaaaaaa-1111-4111-8111-111111111111";
const W2 = "aaaaaaaa-2222-4222-9222-222222222222";
const SH1 = "dddddddd-1111-4111-8111-111111111111";
const MON = "2026-01-05";

const TUE = "2026-01-06";
const EARLY = { id: SH1, label: "Early", startTime: "06:00", endTime: "14:00" };

function renderGrid(
  props: Partial<React.ComponentProps<typeof RosterGrid>> = {},
): string {
  return renderToStaticMarkup(
    <RosterGrid
      planId={PLAN}
      canEdit={false}
      readOnlyReason="Read-only"
      workAreaId={AREA}
      workAreaName="Kitchen"
      shifts={[EARLY]}
      workers={[{ id: W1, employeeId: "EMP-001", name: "Budi Santoso" }]}
      dates={[MON]}
      cells={{}}
      dailyCells={{}}
      rowPage={1}
      workerTotal={1}
      onRowPageChange={() => {}}
      {...props}
    />,
  );
}

describe("RosterGrid", () => {
  test("worker row shows the employee name under the employee id", () => {
    const html = renderGrid();
    expect(html).toContain("EMP-001");
    expect(html).toContain("Budi Santoso");
  });

  test("grid renders only the selected work area's workers", () => {
    const html = renderGrid({ cells: { [`${W1}|${MON}`]: SH1 } });
    // The selected area names the grid; no area switcher lives in the grid.
    expect(html).toContain("Kitchen");
    expect(html).not.toContain('aria-label="Work area"');
    expect(html).toContain("EMP-001");
    expect(html).not.toContain("EMP-002");
    expect(html).toContain("Early");
    expect(html).not.toContain("Daily");
  });

  test("a daily fill shows its shift, times and a Daily tag", () => {
    const html = renderGrid({ dailyCells: { [`${W1}|${MON}`]: SH1 } });
    expect(html).toContain("Early");
    expect(html).toContain("06:00–14:00");
    expect(html).toContain("Daily");
    expect(html).toContain('title="Daily fill, not editable here"');
  });

  test("a daily cell never opens the shift picker, even when editable", () => {
    const html = renderGrid({
      canEdit: true,
      dates: [MON, TUE],
      dailyCells: { [`${W1}|${MON}`]: SH1 },
    });
    expect(html).not.toContain(`Open shift picker for EMP-001 on ${MON}`);
    expect(html).toContain(`Open shift picker for EMP-001 on ${TUE}`);
  });

  test("a weekly cell wins over a daily entry for the same worker-day", () => {
    const html = renderGrid({
      cells: { [`${W1}|${MON}`]: SH1 },
      dailyCells: { [`${W1}|${MON}`]: SH1 },
    });
    expect(html).toContain("Early");
    expect(html).not.toContain("Daily");
  });

  test("a daily fill of a shift outside the list shows the tag without a label", () => {
    const html = renderGrid({
      shifts: [],
      dailyCells: { [`${W1}|${MON}`]: SH1 },
    });
    expect(html).toContain("Daily");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("06:00");
  });

  test("without daily entries no Daily text renders", () => {
    expect(renderGrid({ dates: [MON, TUE] })).not.toContain("Daily");
  });
});

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
    }, recordSet);
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
    }, recordSet);
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
    }, recordSet);
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
    }, recordSet);
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

const PUBLISHED = "55555555-5555-4555-8555-555555555555";
const NEXT_DRAFT = "99999999-9999-4999-8999-999999999999";

describe("commitRevise (the Revise plan wiring into the guarded revisePlan action)", () => {
  test("sends the published plan's id and resolves to the new draft id", async () => {
    reviseCalls.length = 0;
    nextRevise = NEXT_DRAFT;
    const outcome = await commitRevise(PUBLISHED, recordRevise);
    expect(reviseCalls).toEqual([PUBLISHED]);
    expect(outcome).toEqual({ ok: true, draftPlanId: NEXT_DRAFT });
  });

  test("a thrown refusal becomes an error outcome (toast path)", async () => {
    reviseCalls.length = 0;
    nextRevise = new Error("Roster not found.");
    const outcome = await commitRevise(PUBLISHED, recordRevise);
    expect(reviseCalls).toEqual([PUBLISHED]);
    expect(outcome.ok).toBeFalse();
    expect((outcome as { message: string }).message.length).toBeGreaterThan(0);
    expect((outcome as { thrown?: boolean }).thrown).toBeTrue();
    nextRevise = NEXT_DRAFT;
  });

  test("a failure the action returns carries no thrown marker", async () => {
    const returned = async () => ({ ok: false as const, message: "Gone." });
    const outcome = await commitRevise(PUBLISHED, returned);
    expect(outcome).toEqual({ ok: false, message: "Gone." });
    expect("thrown" in outcome).toBeFalse();
  });
});

describe("shouldRefreshAfterRevise", () => {
  test("refreshes after a returned failure", () => {
    expect(shouldRefreshAfterRevise({ ok: false, message: "Gone." })).toBeTrue();
  });

  test("does not refresh after a thrown failure", () => {
    expect(
      shouldRefreshAfterRevise({ ok: false, message: "x", thrown: true }),
    ).toBeFalse();
  });

  test("does not refresh after success", () => {
    expect(
      shouldRefreshAfterRevise({ ok: true, draftPlanId: NEXT_DRAFT }),
    ).toBeFalse();
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
