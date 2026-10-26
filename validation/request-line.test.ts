import { describe, expect, test } from "bun:test";
import {
  advanceStatusSchema,
  mpRequestCreateSchema,
  mpRequestLineSchema,
  mpRequestUpdateSchema,
} from "./request-line";

// Hand-checked fixtures: 2026-10-19 is a Monday, its week runs through
// 2026-10-25 (Sunday), and 2026-10-26 is the next Monday.
const MONDAY = "2026-10-19";
const TUESDAY = "2026-10-20";
const WEDNESDAY = "2026-10-21";
const THURSDAY = "2026-10-22";
const SUNDAY = "2026-10-25";
const NEXT_MONDAY = "2026-10-26";

const WORK_AREA_ID = "0f6a5c3e-2b1d-4c8a-9f0e-7d6c5b4a3f2e";
const SHIFT_DEFINITION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const POSITION_ID = "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f";
const REQUEST_ID = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

const line = (date: string, headcount = 5) => ({
  workAreaId: WORK_AREA_ID,
  shiftDefinitionId: SHIFT_DEFINITION_ID,
  positionId: POSITION_ID,
  date,
  headcount,
});

describe("mpRequestLineSchema", () => {
  test("requires a positionId (per-position demand, epic #135)", () => {
    const { positionId: _omitted, ...withoutPosition } = line(MONDAY);
    const result = mpRequestLineSchema.safeParse(withoutPosition);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["positionId"]);
    }
  });

  test("rejects a non-uuid positionId", () => {
    const result = mpRequestLineSchema.safeParse({
      ...line(MONDAY),
      positionId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid workAreaId", () => {
    const result = mpRequestLineSchema.safeParse({
      ...line(MONDAY),
      workAreaId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid shiftDefinitionId", () => {
    const result = mpRequestLineSchema.safeParse({
      ...line(MONDAY),
      shiftDefinitionId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a malformed date shape", () => {
    expect(mpRequestLineSchema.safeParse(line("2026/10/19")).success).toBe(false);
    expect(mpRequestLineSchema.safeParse(line("19-10-2026")).success).toBe(false);
    expect(mpRequestLineSchema.safeParse(line("2026-1-5")).success).toBe(false);
  });

  test("rejects headcounts below 1 and above 999", () => {
    expect(mpRequestLineSchema.safeParse(line(MONDAY, 0)).success).toBe(false);
    expect(mpRequestLineSchema.safeParse(line(MONDAY, 1000)).success).toBe(false);
  });

  test("accepts boundary headcounts of 1 and 999", () => {
    expect(mpRequestLineSchema.safeParse(line(MONDAY, 1)).success).toBe(true);
    expect(mpRequestLineSchema.safeParse(line(MONDAY, 999)).success).toBe(true);
  });

  test("rejects a non-integer headcount", () => {
    const result = mpRequestLineSchema.safeParse(line(MONDAY, 2.5));
    expect(result.success).toBe(false);
  });
});

describe("mpRequestCreateSchema weekly", () => {
  test("accepts lines spanning Monday through Sunday of the weekStart week", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "weekly",
      weekStart: MONDAY,
      lines: [line(MONDAY), line(SUNDAY)],
    });
    expect(result.success).toBe(true);
  });

  test("requires a weekStart", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "weekly",
      lines: [line(MONDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["weekStart"]);
    }
  });

  test("requires weekStart to be a Monday", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "weekly",
      weekStart: TUESDAY,
      lines: [line(TUESDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["weekStart"]);
    }
  });

  test("rejects a malformed weekStart date shape without crashing", () => {
    // zod v4 runs the superRefine even when the base regex failed, handing
    // it the raw input: the refine must not do date math on it (it used to
    // throw RangeError out of safeParse) and the failure must land on the
    // weekStart field.
    const result = mpRequestCreateSchema.safeParse({
      type: "weekly",
      weekStart: "20261019",
      lines: [line(MONDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("weekStart"))).toBe(true);
    }
  });

  test("rejects a requestDate on a weekly request", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "weekly",
      weekStart: MONDAY,
      requestDate: WEDNESDAY,
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["requestDate"]);
    }
  });

  test("lands an out-of-week line error on that line only", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "weekly",
      weekStart: MONDAY,
      lines: [line(MONDAY), line(NEXT_MONDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["lines", 1, "date"]);
    }
  });

  test("rejects an empty lines array", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "weekly",
      weekStart: MONDAY,
      lines: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("mpRequestCreateSchema daily", () => {
  test("accepts lines that all share the requestDate", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "daily",
      requestDate: WEDNESDAY,
      lines: [line(WEDNESDAY), line(WEDNESDAY)],
    });
    expect(result.success).toBe(true);
  });

  test("requires a requestDate", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "daily",
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["requestDate"]);
    }
  });

  test("rejects a weekStart on a daily request", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "daily",
      weekStart: MONDAY,
      requestDate: WEDNESDAY,
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["weekStart"]);
    }
  });

  test("lands a deviating line error on that line only", () => {
    const result = mpRequestCreateSchema.safeParse({
      type: "daily",
      requestDate: WEDNESDAY,
      lines: [line(WEDNESDAY), line(THURSDAY)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["lines", 1, "date"]);
    }
  });
});

describe("mpRequestCreateSchema notes (field removed, #133)", () => {
  test("a payload carrying notes parses with the key stripped", () => {
    // zod's default object behavior drops unknown keys: a stale client
    // that still sends notes gets a clean parse — never a 400 — and the
    // actions have no notes to persist.
    const result = mpRequestCreateSchema.safeParse({
      type: "daily",
      requestDate: WEDNESDAY,
      notes: "urgent cover",
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("notes" in result.data).toBe(false);
    }
  });
});

describe("mpRequestUpdateSchema", () => {
  test("accepts lines plus id without an anchor", () => {
    const result = mpRequestUpdateSchema.safeParse({
      id: REQUEST_ID,
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(true);
  });

  test("requires an id", () => {
    const result = mpRequestUpdateSchema.safeParse({
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = mpRequestUpdateSchema.safeParse({
      id: "not-a-uuid",
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(false);
  });

  test("strips anchor fields so a client cannot re-anchor a request", () => {
    const result = mpRequestUpdateSchema.safeParse({
      id: REQUEST_ID,
      type: "weekly",
      weekStart: MONDAY,
      requestDate: MONDAY,
      lines: [line(WEDNESDAY)],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("type" in result.data).toBe(false);
      expect("weekStart" in result.data).toBe(false);
      expect("requestDate" in result.data).toBe(false);
    }
  });
});

describe("advanceStatusSchema", () => {
  test("accepts each workflow status", () => {
    for (const status of ["received", "processing", "fulfilled", "rejected"] as const) {
      expect(advanceStatusSchema.safeParse({ id: REQUEST_ID, status }).success).toBe(true);
    }
  });

  test("rejects an unknown status", () => {
    const result = advanceStatusSchema.safeParse({ id: REQUEST_ID, status: "cancelled" });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = advanceStatusSchema.safeParse({ id: "not-a-uuid", status: "received" });
    expect(result.success).toBe(false);
  });
});
