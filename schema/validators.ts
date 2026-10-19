import { ROLES } from "../lib/scope";
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

// Departments & work areas epic (GitHub #60): mirrors locationCreateSchema.
// siteId stays optional at the schema level — the actions resolve the
// actor's own site when the dialog does not send one.
export const departmentCreateSchema = z.object({
  siteId: z.uuid().optional(),
  name: nameField,
});

export const departmentUpdateSchema = departmentCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

export const workAreaCreateSchema = z.object({
  siteId: z.uuid().optional(),
  departmentId: z.uuid(),
  siteLocationId: z.uuid().optional(),
  name: nameField,
});

export const workAreaUpdateSchema = workAreaCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

// Role/binding invariants (docs/architecture.md v0.2 §6): superadmin is
// global (no site/location binding, and — since the departments & work
// areas epic #60 — no department/work-area binding either), ho binds
// exactly one site, may carry one department and never a site_location or
// work area, admin binds exactly one site_location and never a site, with
// optional department/work-area cross-hairpins.
const roleBindingValid = (user: {
  role: string;
  siteId?: string;
  siteLocationId?: string;
  departmentId?: string;
  workAreaId?: string;
}) =>
  user.role === "superadmin"
    ? user.siteId === undefined &&
      user.siteLocationId === undefined &&
      user.departmentId === undefined &&
      user.workAreaId === undefined
    : user.role === "ho"
      ? user.siteId !== undefined &&
        user.siteLocationId === undefined &&
        user.workAreaId === undefined
      : user.siteLocationId !== undefined && user.siteId === undefined;

// Cross-hairpins note: a workAreaId only belongs to an admin (it is
// site_location-scoped); a departmentId is site-scoped and belongs to an
// ho or an admin.
const bindingMessage =
  "superadmin carries no bindings; ho requires siteId, may carry departmentId, and forbids siteLocationId and workAreaId; admin requires siteLocationId, may carry departmentId and workAreaId, and forbids siteId";

const userBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  workAreaId: z.uuid().optional(),
});

export const userCreateSchema = userBaseSchema.refine(roleBindingValid, {
  message: bindingMessage,
});

// createUser's parse: validates the creation input against userCreateSchema.
// Dialogs send binding keys their role does not own (nulls from unrendered
// selects, stale fields from a role switch): those keys are stripped before
// validation so the role refine judges only the bindings the role owns
// (per issue #11's refines). ho keeps siteId and departmentId — a null/
// absent siteId surfaces as a per-field siteId error — and strips
// siteLocationId and workAreaId; admin keeps siteLocationId, departmentId
// and workAreaId and strips siteId; superadmin gets all four stripped.
const keptBindings = (
  role: string,
  input: {
    siteId?: string | null;
    siteLocationId?: string | null;
    departmentId?: string | null;
    workAreaId?: string | null;
  },
) =>
  role === "ho"
    ? { siteId: input.siteId, departmentId: input.departmentId }
    : role === "admin"
      ? {
          siteLocationId: input.siteLocationId,
          departmentId: input.departmentId,
          workAreaId: input.workAreaId,
        }
      : {};

export function parseUserCreate(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  siteId?: string | null;
  siteLocationId?: string | null;
  departmentId?: string | null;
  workAreaId?: string | null;
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
  // The user id is a text column holding Better Auth generated ids
  // (non-UUID), so it only needs to be present.
  .extend({ id: z.string().min(1) })
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
    departmentId?: string | null;
    workAreaId?: string | null;
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
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;
export type WorkAreaCreateInput = z.infer<typeof workAreaCreateSchema>;
export type WorkAreaUpdateInput = z.infer<typeof workAreaUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
