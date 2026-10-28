import "dotenv/config";
import { describe, expect, test } from "bun:test";

import type { ActionState } from "@/types/action-state";
import type { DayRow, RecordInput } from "@/types/attendance";

import {
  buildCorrectionInput,
  buildUnscheduledInput,
  candidatesFor,
  canSubmitCorrection,
  canSubmitUnscheduled,
  commitAddUnscheduled,
  commitBulk,
  commitCorrect,
  commitRecord,
  commitRemoveUnscheduled,
  correctionChanged,
  draftOf,
  isPushableDate,
  selectable,
  selectedUnrecordedIds,
  unrecordedWorkerIds,
  withCurrent,
} from "./attendance-commit";

// The write wiring of the day page, kept pure so it is testable without a DOM:
// each commit takes the server action as an argument (recording stubs here), so
// no process-wide module mock leaks into other suites. The components call
// these inside a transition, toast the outcome and refresh the route when
// the outcome says the view is stale.

const DATE = "2026-01-07";
const W1 = "aaaaaaaa-1111-4111-8111-111111111111";
const W2 = "aaaaaaaa-2222-4222-8222-222222222222";
const W3 = "aaaaaaaa-3333-4333-8333-333333333333";
const REC = "bbbbbbbb-1111-4111-8111-111111111111";
const EARLY = "cccccccc-1111-4111-8111-111111111111";
const LATE = "cccccccc-2222-4222-8222-222222222222";
const AREA = "dddddddd-1111-4111-8111-111111111111";

function recorder(result: ActionState) {
  const calls: unknown[] = [];
  const act = async (input: unknown) => {
    calls.push(input);
    return result;
  };
  return { calls, act };
}

const thrower = async () => {
  throw new Error("network down");
};

describe("commitRecord", () => {
  test("sends the date, worker and status and reports the outcome", async () => {
    const { calls, act } = recorder({ ok: true });

    const outcome = await commitRecord(
      { date: DATE, workerId: W1, status: "sick" },
      "EMP-001",
      act,
    );

    expect(calls).toEqual([{ date: DATE, workerId: W1, status: "sick" }]);
    expect(outcome).toEqual({
      ok: true,
      message: "EMP-001 marked sick.",
      refresh: false,
    });
  });

  test("a returned failure carries the message and asks for a refresh", async () => {
    const { act } = recorder({ ok: false, message: "Already recorded, reload" });

    const outcome = await commitRecord(
      { date: DATE, workerId: W1, status: "present" },
      "EMP-001",
      act,
    );

    expect(outcome).toEqual({
      ok: false,
      message: "Already recorded, reload",
      refresh: true,
    });
  });

  test("a thrown error is a generic failure and does not refresh", async () => {
    const outcome = await commitRecord(
      { date: DATE, workerId: W1, status: "present" },
      "EMP-001",
      thrower,
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.refresh).toBe(false);
    expect(outcome.message).toBe("Something went wrong. Please try again.");
  });
});

describe("commitBulk", () => {
  test("reports how many were marked and how many skipped", async () => {
    const { calls, act } = recorder({ ok: true, applied: 2, blocked: 1 });

    const outcome = await commitBulk(
      { date: DATE, workerIds: [W1, W2, W3], status: "present" },
      act,
    );

    expect(calls).toEqual([
      { date: DATE, workerIds: [W1, W2, W3], status: "present" },
    ]);
    expect(outcome).toEqual({
      ok: true,
      message: "2 marked present, 1 skipped.",
      refresh: false,
    });
  });

  test("nothing skipped leaves the skipped part out", async () => {
    const { act } = recorder({ ok: true, applied: 3, blocked: 0 });

    expect(
      (await commitBulk({ date: DATE, workerIds: [W1], status: "leave" }, act))
        .message,
    ).toBe("3 marked leave.");
  });

  test("nothing marked says so and still counts as done", async () => {
    const { act } = recorder({ ok: true, applied: 0, blocked: 2 });

    const outcome = await commitBulk(
      { date: DATE, workerIds: [W1, W2], status: "absent" },
      act,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toBe("Nothing marked, 2 skipped.");
  });

  test("a returned failure carries the message and asks for a refresh", async () => {
    const { act } = recorder({
      ok: false,
      message: "At most 500 rows per bulk entry",
    });

    expect(
      await commitBulk({ date: DATE, workerIds: [W1], status: "present" }, act),
    ).toEqual({
      ok: false,
      message: "At most 500 rows per bulk entry",
      refresh: true,
    });
  });
});

describe("selection helpers", () => {
  const rows = [
    { workerId: W1, state: "unrecorded" },
    { workerId: W2, state: "recorded" },
    { workerId: W3, state: "unrecorded" },
  ] as DayRow[];

  test("unrecordedWorkerIds lists only the rows nobody has recorded", () => {
    expect(unrecordedWorkerIds(rows)).toEqual([W1, W3]);
  });

  test("selectedUnrecordedIds keeps only selected rows that are still unrecorded", () => {
    expect(selectedUnrecordedIds(rows, new Set([W1, W2, "gone"]))).toEqual([W1]);
    expect(selectedUnrecordedIds(rows, new Set())).toEqual([]);
  });
});

describe("correction", () => {
  const record: RecordInput = {
    id: REC,
    workerId: W1,
    shiftDefId: EARLY,
    workAreaId: AREA,
    status: "present",
    withoutRoster: false,
    rosteredShiftDefId: EARLY,
    reason: null,
  };
  const row = {
    workerId: W1,
    record,
    state: "recorded",
    shiftDiffers: false,
    rosterShiftDefId: EARLY,
    rosterWorkAreaId: AREA,
  } as DayRow;

  test("the draft starts from what is on screen with an empty reason", () => {
    expect(draftOf(row)).toEqual({
      status: "present",
      shiftDefinitionId: EARLY,
      reason: "",
    });
  });

  test("it is submittable only with a non-blank reason and something changed", () => {
    const base = draftOf(row);

    expect(canSubmitCorrection(row, base)).toBe(false);
    expect(canSubmitCorrection(row, { ...base, status: "sick" })).toBe(false);
    expect(canSubmitCorrection(row, { ...base, reason: "typo" })).toBe(false);
    expect(
      canSubmitCorrection(row, { ...base, status: "sick", reason: "   " }),
    ).toBe(false);
    expect(
      canSubmitCorrection(row, { ...base, status: "sick", reason: "note" }),
    ).toBe(true);
    expect(
      canSubmitCorrection(row, {
        ...base,
        shiftDefinitionId: LATE,
        reason: "swapped",
      }),
    ).toBe(true);
  });

  test("correctionChanged compares against the on-screen record", () => {
    expect(correctionChanged(row, draftOf(row))).toBe(false);
    expect(correctionChanged(row, { ...draftOf(row), status: "absent" })).toBe(
      true,
    );
    expect(
      correctionChanged(row, { ...draftOf(row), shiftDefinitionId: LATE }),
    ).toBe(true);
  });

  test("the input carries the on-screen values, only the changed fields and the reason", () => {
    expect(
      buildCorrectionInput(row, {
        status: "sick",
        shiftDefinitionId: EARLY,
        reason: "  Doctor's note  ",
      }),
    ).toEqual({
      recordId: REC,
      expectedStatus: "present",
      expectedShiftDefinitionId: EARLY,
      status: "sick",
      reason: "Doctor's note",
    });
    expect(
      buildCorrectionInput(row, {
        status: "present",
        shiftDefinitionId: LATE,
        reason: "swapped",
      }),
    ).toEqual({
      recordId: REC,
      expectedStatus: "present",
      expectedShiftDefinitionId: EARLY,
      shiftDefinitionId: LATE,
      reason: "swapped",
    });
  });

  test("commitCorrect sends the input and reports the outcome", async () => {
    const { calls, act } = recorder({ ok: true });
    const input = buildCorrectionInput(row, {
      status: "sick",
      shiftDefinitionId: EARLY,
      reason: "note",
    });

    const outcome = await commitCorrect(input, "EMP-001", act);

    expect(calls).toEqual([input]);
    expect(outcome).toEqual({
      ok: true,
      message: "EMP-001 corrected.",
      refresh: false,
    });
  });

  test("a changed-meanwhile failure asks for a refresh", async () => {
    const { act } = recorder({
      ok: false,
      message: "Attendance changed meanwhile, reload",
    });

    const outcome = await commitCorrect(
      {
        recordId: REC,
        expectedStatus: "present",
        expectedShiftDefinitionId: EARLY,
        status: "sick",
        reason: "x",
      },
      "EMP-001",
      act,
    );

    expect(outcome).toEqual({
      ok: false,
      message: "Attendance changed meanwhile, reload",
      refresh: true,
    });
  });
});

// A date field fires change on every keystroke: typing the year 2026 yields
// 0002, 0020, 0202 and only then 2026. Only the last is a day worth loading.
describe("isPushableDate", () => {
  test("accepts a complete, real date in a plausible year", () => {
    for (const date of ["2026-10-29", "2000-01-01", "2024-02-29"]) {
      expect(isPushableDate(date)).toBe(true);
    }
  });

  test("refuses the intermediate values of typing a year", () => {
    for (const date of ["0002-10-29", "0020-10-29", "0202-10-29", "1999-10-29"]) {
      expect(isPushableDate(date)).toBe(false);
    }
  });

  test("refuses an empty, partial or impossible value", () => {
    for (const date of ["", "2026-10", "2026-02-30", "junk", "2026-1-7"]) {
      expect(isPushableDate(date)).toBe(false);
    }
  });
});

describe("pickers", () => {
  test("candidatesFor drops the workers already on the day's list", () => {
    const candidates = [
      { id: W1, employeeId: "EMP-001", name: "Budi" },
      { id: W2, employeeId: "EMP-002", name: "Sari" },
      { id: W3, employeeId: "EMP-003", name: "Dewi" },
    ];

    expect(candidatesFor(candidates, [W2]).map((c) => c.id)).toEqual([W1, W3]);
    expect(candidatesFor(candidates, [])).toHaveLength(3);
    expect(candidatesFor(candidates, [W1, W2, W3])).toEqual([]);
  });

  test("selectable keeps only the options that can still be picked", () => {
    const options = [
      { id: "a", selectable: true },
      { id: "b", selectable: false },
      { id: "c", selectable: true },
    ];

    expect(selectable(options).map((o) => o.id)).toEqual(["a", "c"]);
  });

  test("withCurrent keeps a retired option that is already on the row so its label still shows", () => {
    const options = [
      { id: "a", selectable: true },
      { id: "b", selectable: false },
      { id: "c", selectable: false },
    ];

    expect(withCurrent(options, "b").map((o) => o.id)).toEqual(["a", "b"]);
    expect(withCurrent(options, "a").map((o) => o.id)).toEqual(["a"]);
    expect(withCurrent(options, "").map((o) => o.id)).toEqual(["a"]);
  });
});

describe("unscheduled rows", () => {
  const draft = {
    workerId: W1,
    workAreaId: AREA,
    shiftDefinitionId: EARLY,
    status: "present" as const,
    reason: "Covering",
  };

  test("it is submittable only when every field is set and the reason is not blank", () => {
    expect(canSubmitUnscheduled(draft)).toBe(true);
    expect(canSubmitUnscheduled({ ...draft, workerId: "" })).toBe(false);
    expect(canSubmitUnscheduled({ ...draft, workAreaId: "" })).toBe(false);
    expect(canSubmitUnscheduled({ ...draft, shiftDefinitionId: "" })).toBe(false);
    expect(canSubmitUnscheduled({ ...draft, reason: "  " })).toBe(false);
  });

  test("the input carries the date and a trimmed reason", () => {
    expect(
      buildUnscheduledInput(DATE, { ...draft, reason: "  Covering  " }),
    ).toEqual({
      date: DATE,
      workerId: W1,
      workAreaId: AREA,
      shiftDefinitionId: EARLY,
      status: "present",
      reason: "Covering",
    });
  });

  test("commitAddUnscheduled sends the input and reports the outcome", async () => {
    const { calls, act } = recorder({ ok: true });
    const input = buildUnscheduledInput(DATE, draft);

    const outcome = await commitAddUnscheduled(input, "EMP-009", act);

    expect(calls).toEqual([input]);
    expect(outcome).toEqual({
      ok: true,
      message: "EMP-009 added as unscheduled.",
      refresh: false,
    });
  });

  test("commitRemoveUnscheduled sends the record id and a trimmed reason", async () => {
    const { calls, act } = recorder({ ok: true });

    const outcome = await commitRemoveUnscheduled(
      { recordId: REC, reason: "  wrong worker " },
      "EMP-009",
      act,
    );

    expect(calls).toEqual([{ recordId: REC, reason: "wrong worker" }]);
    expect(outcome).toEqual({
      ok: true,
      message: "EMP-009 removed.",
      refresh: false,
    });
  });

  test("a returned failure asks for a refresh", async () => {
    const { act } = recorder({ ok: false, message: "Worker not found." });

    expect(
      await commitAddUnscheduled(buildUnscheduledInput(DATE, draft), "EMP-009", act),
    ).toEqual({ ok: false, message: "Worker not found.", refresh: true });
  });
});
