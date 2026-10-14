import { z } from "zod";

const nameField = z.string().trim().min(1).max(200);

export const clientCreateSchema = z.object({
  name: nameField,
});

export const clientUpdateSchema = clientCreateSchema.extend({
  id: z.uuid(),
});

export const siteCreateSchema = z.object({
  clientId: z.uuid(),
  name: nameField,
  location: z.string().trim().min(1).max(200),
});

export const siteUpdateSchema = siteCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export const userCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email(),
    password: z.string().min(8),
    role: z.enum(["ho", "site_admin"]),
    siteId: z.uuid().optional(),
  })
  .refine((user) => (user.role === "ho" ? user.siteId === undefined : user.siteId !== undefined), {
    message: "site_admin requires a siteId; ho must not have one",
  });

export const userPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;
export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
