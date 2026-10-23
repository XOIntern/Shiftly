import { z } from "zod";

export const locationCreateSchema = z.object({
  siteId: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
});

export const locationUpdateSchema = locationCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
