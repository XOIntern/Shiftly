import { z } from "zod";

export const workerCreateSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid(),
  employeeId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  positionIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Select each position once",
    }),
  contractEndDate: z
    .string({ error: "Contract end is required" })
    .min(1, "Contract end is required")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Contract end must be a valid date"),
});

export const workerUpdateSchema = workerCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export type WorkerCreateInput = z.infer<typeof workerCreateSchema>;
export type WorkerUpdateInput = z.infer<typeof workerUpdateSchema>;
