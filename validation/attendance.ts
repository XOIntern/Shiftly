import { z } from "zod";

import { dayFromNumber, dayNumber } from "@/lib/dates";
import { ATTENDANCE_STATUSES } from "@/types/attendance";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// A "YYYY-MM-DD" that is also a real calendar day: the shape alone lets
// "2026-02-30" through to a date column that rejects it. zod runs a refine
// even after an earlier check failed, so the refine re-checks the shape itself
// before doing date math on text it could not read (a RangeError would be a 500).
export const attendanceDateSchema = z
  .string()
  .regex(DATE_SHAPE)
  .refine(
    (date) => DATE_SHAPE.test(date) && dayFromNumber(dayNumber(date)) === date,
  );

export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const recordAttendanceSchema = z.object({
  date: attendanceDateSchema,
  workerId: z.uuid(),
  status: attendanceStatusSchema,
});

// The list may name any number of ids; the 500-row cap is applied by the
// action after duplicates collapse, so it can answer with its own message.
export const bulkRecordSchema = z.object({
  date: attendanceDateSchema,
  workerIds: z.array(z.uuid()),
  status: attendanceStatusSchema,
});

// The reason is checked apart from these (blank has its own message), so it is
// not part of the shapes below.
export const correctAttendanceSchema = z.object({
  recordId: z.uuid(),
  expectedStatus: attendanceStatusSchema,
  expectedShiftDefinitionId: z.uuid(),
  status: attendanceStatusSchema.optional(),
  shiftDefinitionId: z.uuid().optional(),
});

export const addUnscheduledSchema = z.object({
  date: attendanceDateSchema,
  workerId: z.uuid(),
  workAreaId: z.uuid(),
  shiftDefinitionId: z.uuid(),
  status: attendanceStatusSchema,
});

export const removeUnscheduledSchema = z.object({ recordId: z.uuid() });

export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;
export type BulkRecordInput = z.infer<typeof bulkRecordSchema>;
