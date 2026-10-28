import { z } from "zod";

import { LOCATION_TIMEZONES } from "@/types/timezone";

export const locationCreateSchema = z.object({
  siteId: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  timezone: z.enum(LOCATION_TIMEZONES).default("Asia/Jakarta"),
});

// An update that sends no time zone keeps the stored one, so it is optional
// here with no default (a default would silently reset it).
export const locationUpdateSchema = locationCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
  timezone: z.enum(LOCATION_TIMEZONES).optional(),
});

export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
