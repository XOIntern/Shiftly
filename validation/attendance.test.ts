import { describe, expect, test } from "bun:test";

import {
  addUnscheduledSchema,
  attendanceDateSchema,
  bulkRecordSchema,
  correctAttendanceSchema,
  recordAttendanceSchema,
  removeUnscheduledSchema,
} from "./attendance";

const UUID = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

describe("attendanceDateSchema", () => {
  test("accepts real calendar days, leap day included", () => {
    for (const date of ["2026-01-07", "2024-02-29", "2026-12-31"]) {
      expect(attendanceDateSchema.safeParse(date).success).toBe(true);
    }
  });

  test("refuses a day that is not on the calendar", () => {
    for (const date of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10"]) {
      expect(attendanceDateSchema.safeParse(date).success).toBe(false);
    }
  });

  // zod runs a refine even after the regex failed, so the refine itself must
  // survive a value it cannot read: a thrown RangeError would be a 500.
  test("refuses text that is not a date without throwing", () => {
    for (const date of [
      "junk",
      "",
      "2026-1-7",
      "07-01-2026",
      "abcd-ef-gh",
      "9999-99-99",
      "0000-00-00",
      "2026-01-07T00:00:00Z",
    ]) {
      expect(() => attendanceDateSchema.safeParse(date)).not.toThrow();
      expect(attendanceDateSchema.safeParse(date).success).toBe(false);
    }
  });

  test("refuses a value that is not a string", () => {
    for (const date of [undefined, null, 20260107, {}]) {
      expect(attendanceDateSchema.safeParse(date).success).toBe(false);
    }
  });
});

describe("recordAttendanceSchema", () => {
  test("accepts a date, a worker id and a status", () => {
    expect(
      recordAttendanceSchema.safeParse({
        date: "2026-01-07",
        workerId: UUID,
        status: "present",
      }).success,
    ).toBe(true);
  });

  test("refuses a bad date without throwing", () => {
    expect(() =>
      recordAttendanceSchema.safeParse({
        date: "junk",
        workerId: UUID,
        status: "present",
      }),
    ).not.toThrow();
  });

  test("refuses an unknown status and a malformed worker id", () => {
    expect(
      recordAttendanceSchema.safeParse({
        date: "2026-01-07",
        workerId: UUID,
        status: "late",
      }).success,
    ).toBe(false);
    expect(
      recordAttendanceSchema.safeParse({
        date: "2026-01-07",
        workerId: "nope",
        status: "present",
      }).success,
    ).toBe(false);
  });
});

describe("bulkRecordSchema", () => {
  test("accepts any number of uuids (the cap is the action's)", () => {
    expect(
      bulkRecordSchema.safeParse({
        date: "2026-01-07",
        workerIds: [UUID, UUID],
        status: "leave",
      }).success,
    ).toBe(true);
    expect(
      bulkRecordSchema.safeParse({
        date: "2026-01-07",
        workerIds: ["nope"],
        status: "leave",
      }).success,
    ).toBe(false);
  });
});

describe("correctAttendanceSchema", () => {
  test("the new status and shift are optional", () => {
    expect(
      correctAttendanceSchema.safeParse({
        recordId: UUID,
        expectedStatus: "present",
        expectedShiftDefinitionId: UUID,
      }).success,
    ).toBe(true);
  });

  test("a malformed record or shift id is refused", () => {
    expect(
      correctAttendanceSchema.safeParse({
        recordId: "nope",
        expectedStatus: "present",
        expectedShiftDefinitionId: UUID,
      }).success,
    ).toBe(false);
    expect(
      correctAttendanceSchema.safeParse({
        recordId: UUID,
        expectedStatus: "present",
        expectedShiftDefinitionId: UUID,
        shiftDefinitionId: "nope",
      }).success,
    ).toBe(false);
  });
});

describe("addUnscheduledSchema and removeUnscheduledSchema", () => {
  test("accept well-formed input and refuse a bad date or id", () => {
    expect(
      addUnscheduledSchema.safeParse({
        date: "2026-01-07",
        workerId: UUID,
        workAreaId: UUID,
        shiftDefinitionId: UUID,
        status: "absent",
      }).success,
    ).toBe(true);
    expect(() =>
      addUnscheduledSchema.safeParse({
        date: "junk",
        workerId: UUID,
        workAreaId: UUID,
        shiftDefinitionId: UUID,
        status: "absent",
      }),
    ).not.toThrow();
    expect(removeUnscheduledSchema.safeParse({ recordId: UUID }).success).toBe(
      true,
    );
    expect(removeUnscheduledSchema.safeParse({ recordId: "nope" }).success).toBe(
      false,
    );
  });
});
