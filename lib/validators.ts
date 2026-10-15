import { ROLES } from "./scope";
import { z } from "zod";

const nameField = z.string().trim().min(1).max(200);

export const siteCreateSchema = z.object({
  name: nameField,
});

export const siteUpdateSchema = siteCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export const locationCreateSchema = z.object({
  siteId: z.uuid().optional(),
  name: nameField,
});

export const locationUpdateSchema = locationCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

// Role/binding invariants (docs/architecture.md v0.2 §6): superadmin is
// global (neither binding), ho binds exactly one site and never a
// site_location, admin binds exactly one site_location and never a site.
const roleBindingValid = (user: {
  role: string;
  siteId?: string;
  siteLocationId?: string;
}) =>
  user.role === "superadmin"
    ? user.siteId === undefined && user.siteLocationId === undefined
    : user.role === "ho"
      ? user.siteId !== undefined && user.siteLocationId === undefined
      : user.siteLocationId !== undefined && user.siteId === undefined;

const bindingMessage =
  "superadmin carries no bindings; ho requires siteId and forbids siteLocationId; admin requires siteLocationId and forbids siteId";

const userBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid().optional(),
});

export const userCreateSchema = userBaseSchema.refine(roleBindingValid, {
  message: bindingMessage,
});

// createUser's parse: validates the creation input against userCreateSchema.
// Dialogs send binding keys their role does not own (nulls from unrendered
// selects, stale fields from a role switch): those keys are stripped before
// validation so the role refine judges only the bindings the role owns
// (per issue #11's refines). ho keeps siteId — a null/absent one surfaces
// as a per-field siteId error — and strips siteLocationId; admin keeps
// siteLocationId and strips siteId; superadmin gets both stripped.
const keptBindings = (
  role: string,
  input: {
    siteId?: string | null;
    siteLocationId?: string | null;
  },
) =>
  role === "ho"
    ? { siteId: input.siteId }
    : role === "admin"
      ? { siteLocationId: input.siteLocationId }
      : {};

export function parseUserCreate(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  siteId?: string | null;
  siteLocationId?: string | null;
}) {
  const role = input.role;
  return userCreateSchema.safeParse({
    name: input.name,
    email: input.email,
    password: input.password,
    role,
    ...keptBindings(role, input),
  });
}

export const userPasswordSchema = z.object({
  newPassword: z.string().min(8),
});

// Self-service change-password (/settings): any non-empty current password
// (its correctness is the action's job), plus the same 8-char minimum the
// admin-facing schemas enforce. Comparing the two inputs (not against the
// stored hash) is sound here: the action only calls the API after verifying
// currentPassword, so a matching currentPassword string IS the stored
// password. fieldErrorsFrom routes the issue by path, landing on
// fieldErrors.newPassword.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current password.",
  });

// Same field rules as userCreateSchema minus the password (edits use
// resetPassword for that) and minus email (email edits need Better Auth
// semantics and are out of scope for updateUser), with the same
// role/binding refine kept.
export const userUpdateSchema = userBaseSchema
  .omit({ password: true, email: true })
  .extend({ id: z.uuid() })
  .refine(roleBindingValid, { message: bindingMessage });

// updateUser's parse: validates an {id, name, role, bindings?} edit against
// userUpdateSchema. Stripping follows the same per-role rule as
// parseUserCreate (switching a user to superadmin clears both bindings;
// a ho edit never carries a siteLocationId), so the refine cannot reject a
// role switch for carrying now-irrelevant bindings. admin edits never get
// their siteLocationId stripped — a missing one still fails.
export function parseUserUpdate(
  id: string,
  input: {
    name: string;
    role: string;
    siteId?: string | null;
    siteLocationId?: string | null;
  },
) {
  const role = input.role;
  return userUpdateSchema.safeParse({
    id,
    name: input.name,
    role,
    ...keptBindings(role, input),
  });
}

export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>;
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
