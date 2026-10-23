import { z } from "zod";

export const positionCreateSchema = z.object({
  siteId: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
});

export const positionUpdateSchema = positionCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export type PositionCreateInput = z.infer<typeof positionCreateSchema>;
export type PositionUpdateInput = z.infer<typeof positionUpdateSchema>;
