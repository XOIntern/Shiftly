import { z } from "zod";

export const workAreaCreateSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid(),
  name: z.string().trim().min(1).max(100),
});

export const workAreaUpdateSchema = workAreaCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
  requiredPositionIds: z
    .array(z.uuid())
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Select each position once",
    })
    .optional(),
});

export type WorkAreaCreateInput = z.infer<typeof workAreaCreateSchema>;
export type WorkAreaUpdateInput = z.infer<typeof workAreaUpdateSchema>;
