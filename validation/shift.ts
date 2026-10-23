import { z } from "zod";

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be a valid HH:MM");

export const shiftCreateSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid(),
  label: z.string().trim().min(1).max(100),
  orderIndex: z.number().int().min(1).max(20),
  startTime: hhmm,
  endTime: hhmm,
});

export const shiftUpdateSchema = shiftCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export type ShiftCreateInput = z.infer<typeof shiftCreateSchema>;
export type ShiftUpdateInput = z.infer<typeof shiftUpdateSchema>;
