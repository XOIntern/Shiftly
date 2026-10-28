import { z } from "zod";

import { dayFromNumber, dayNumber } from "@/lib/dates";
import { ATTENDANCE_STATUSES } from "@/types/attendance";

// A "YYYY-MM-DD" that is also a real calendar day: the shape alone lets
// "2026-02-30" through to a date column that rejects it.
export const attendanceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((date) => dayFromNumber(dayNumber(date)) === date);

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
