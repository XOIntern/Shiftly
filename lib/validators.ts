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

const userBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(["ho", "site_admin"]),
  siteId: z.uuid().optional(),
});

export const userCreateSchema = userBaseSchema.refine(
  (user) => (user.role === "ho" ? user.siteId === undefined : user.siteId !== undefined),
  {
    message: "site_admin requires a siteId; ho must not have one",
  },
);

export const userPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

// Same field rules as userCreateSchema minus the password (edits use
// resetPassword for that) and minus email (email edits need Better Auth
// semantics and are out of scope for updateUser), with the
// ho↔site_admin siteId refine kept.
export const userUpdateSchema = userBaseSchema
  .omit({ password: true, email: true })
  .extend({ id: z.uuid() })
  .refine((user) => (user.role === "ho" ? user.siteId === undefined : user.siteId !== undefined), {
    message: "site_admin requires a siteId; ho must not have one",
  });

// updateUser's parse: validates an {id, name, role, siteId?} edit against
// userUpdateSchema. A stale siteId sent along with role "ho" is stripped
// before validation ("moving a user to ho clears siteId") so the refine
// cannot reject a role switch for carrying a now-irrelevant site.
// site_admin edits never get stripped — a missing siteId still fails.
export function parseUserUpdate(
  id: string,
  input: { name: string; role: string; siteId?: string | null },
) {
  const isHo = input.role === "ho";
  return userUpdateSchema.safeParse({
    id,
    name: input.name,
    role: input.role,
    ...(isHo ? {} : { siteId: input.siteId }),
  });
}

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;
export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
