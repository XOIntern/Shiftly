import { isMonday, weekDates } from "../lib/week";
import { ROLES } from "../lib/scope";
import { z } from "zod";

const nameField = z.string().trim().min(1).max(200);

export const locationCreateSchema = z.object({
  siteId: z.uuid().optional(),
  name: nameField,
});

export const locationUpdateSchema = locationCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

// Work areas (dropped-department epic, 2026-10-19): mirrors
// locationCreateSchema. siteId stays optional at the schema level — the
// actions derive it from the site_location, so the dialog does not send
// one. siteLocationId is required: the work area reports to its location
// directly.
export const workAreaCreateSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid(),
  name: nameField,
});

// requiredPositionIds (roster spec §3.1, C7 activation) is update-only:
// absent = leave the work area's required-position set unchanged; an array
// (even empty) replaces the set wholesale. Max 20 keeps a dialog from
// shipping an unbounded batch; duplicates answer the same per-field error
// the worker qualification set uses.
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

// Positions (per-site catalog): mirrors locationCreateSchema — the position
// parents directly under a site, so siteId is optional at the schema level
// (superadmin picks it in the dialog; ho/admin paths derive it server-side
// from their bindings, never trusting the client).
export const positionCreateSchema = z.object({
  siteId: z.uuid().optional(),
  name: nameField,
});

export const positionUpdateSchema = positionCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

// Workers (worker-crud epic, 2026-10-20; multi-position spec, 2026-10-20):
// mirrors workAreaCreateSchema — siteLocationId is required (the worker
// reports to its location) and positionIds holds the worker's qualification
// set, one or more positions of its own site (no primary, no order).
// siteId stays optional at the schema level (the actions derive it from the
// site_location, so the dialog does not send one). contractEndDate is a
// required date string (issue #119): missing or empty answers
// "Contract end is required", a malformed string answers
// "Contract end must be a valid date". Legacy NULL rows are untouched until
// their next edit — toggle/delete never parse this schema.
export const workerCreateSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid(),
  positionIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Select each position once",
    }),
  employeeId: z.string().trim().min(1).max(100),
  name: nameField,
  contractEndDate: z
    .string({ error: "Contract end is required" })
    .min(1, "Contract end is required")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Contract end must be a valid date"),
});

export const workerUpdateSchema = workerCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

// Shifts (mp-requests epic, Module 3): mirrors workAreaCreateSchema —
// siteLocationId is required (the shift belongs to one location) and siteId
// stays optional at the schema level (the actions derive it from the
// site_location, so the dialog does not send one). orderIndex is the
// per-location display slot (1..20) behind the partial unique on
// (site_location_id, order_index) WHERE deleted_at IS NULL; startTime /
// endTime are wall-clock HH:MM strings, not timestamps.
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be a valid HH:MM");

export const shiftCreateSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid(),
  label: nameField,
  orderIndex: z.number().int().min(1).max(20),
  startTime: hhmm,
  endTime: hhmm,
});

export const shiftUpdateSchema = shiftCreateSchema.extend({
  id: z.uuid(),
  isActive: z.boolean(),
});

// MP requests (Module 3, spec §3.3/§4): one weekly (Monday-anchored) or
// daily requirement per site_location, filled with per-work-area/per-shift
// lines. Anchors and line dates are plain "YYYY-MM-DD" strings — the DB
// carries the belt-and-braces (anchor CHECKs, dow rule, headcount CHECK,
// open-slot uniques), and this refine mirrors the anchor rules so bad
// shapes fail before the driver does. Uniqueness is DB-level only (Task 5
// partial indexes) — never re-derived here.
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be a valid YYYY-MM-DD");

export const mpRequestLineSchema = z.object({
  workAreaId: z.uuid(),
  shiftDefinitionId: z.uuid(),
  date: dateString,
  headcount: z.number().int().min(1).max(999),
});

// Controller ruling (pre-flight): siteLocationId stays optional at the
// schema level — an admin's is replaced with the pinned session value
// (effectiveSiteLocationId pattern) in the actions, a superadmin's passes
// through with a site weld check. siteId stays optional like every other
// create schema (derived server-side for ho/admin).
const mpRequestBaseSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid().optional(),
  type: z.enum(["weekly", "daily"]),
  weekStart: dateString.optional(),
  requestDate: dateString.optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(mpRequestLineSchema).min(1),
});

// Issues are placed so fieldErrorsFrom lands them per-field: anchor-shape
// problems on the weekStart / requestDate path, line-date problems on the
// offending line (lines.<i>.date).
export const mpRequestCreateSchema = mpRequestBaseSchema.superRefine(
  (data, ctx) => {
    if (data.type === "weekly") {
      if (data.requestDate !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["requestDate"],
          message: "A weekly request must not carry a request date",
        });
      }
      if (data.weekStart === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["weekStart"],
          message: "Week start is required",
        });
        return;
      }
      if (!isMonday(data.weekStart)) {
        ctx.addIssue({
          code: "custom",
          path: ["weekStart"],
          message: "Week start must be a Monday",
        });
      }
      const week = new Set(weekDates(data.weekStart));
      data.lines.forEach((line, index) => {
        if (!week.has(line.date)) {
          ctx.addIssue({
            code: "custom",
            path: ["lines", index, "date"],
            message: "Line date must fall within the request week",
          });
        }
      });
      return;
    }
    if (data.weekStart !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["weekStart"],
        message: "A daily request must not carry a week start",
      });
    }
    if (data.requestDate === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["requestDate"],
        message: "Request date is required",
      });
      return;
    }
    data.lines.forEach((line, index) => {
      if (line.date !== data.requestDate) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "date"],
          message: "Every line must share the request date",
        });
      }
    });
  },
);

// Anchor/type are immutable after creation: the update drops them here, so
// the actions validate line dates against the STORED anchor instead.
export const mpRequestUpdateSchema = mpRequestBaseSchema
  .omit({ type: true, weekStart: true, requestDate: true })
  .extend({ id: z.uuid() });

export const advanceStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["received", "processing", "fulfilled", "rejected"]),
});

// Role/binding invariants (docs/architecture.md v0.2 §6): superadmin is
// global (no site/location binding, and — since the dropped-department
// epic — no department binding either), ho binds exactly one site and
// never a site_location, admin binds exactly one site_location and never
// a site.
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
  password: z.string().min(15, "Password must be at least 15 characters").max(200),
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
// (per issue #11's refines). ho keeps siteId — a null/absent siteId
// surfaces as a per-field siteId error — and strips siteLocationId; admin
// keeps siteLocationId and strips siteId; superadmin gets both stripped.
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
  newPassword: z.string().min(15, "Password must be at least 15 characters").max(200),
});

// Self-service change-password (/settings): any non-empty current password
// (its correctness is the action's job), plus the same 15-char minimum the
// admin-facing schemas enforce. Comparing the two inputs (not against the
// stored hash) is sound here: the action only calls the API after verifying
// currentPassword, so a matching currentPassword string IS the stored
// password. fieldErrorsFrom routes the issue by path, landing on
// fieldErrors.newPassword.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(15, "Password must be at least 15 characters").max(200),
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

export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
export type WorkAreaCreateInput = z.infer<typeof workAreaCreateSchema>;
export type WorkAreaUpdateInput = z.infer<typeof workAreaUpdateSchema>;
export type PositionCreateInput = z.infer<typeof positionCreateSchema>;
export type PositionUpdateInput = z.infer<typeof positionUpdateSchema>;
export type WorkerCreateInput = z.infer<typeof workerCreateSchema>;
export type WorkerUpdateInput = z.infer<typeof workerUpdateSchema>;
export type ShiftCreateInput = z.infer<typeof shiftCreateSchema>;
export type ShiftUpdateInput = z.infer<typeof shiftUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
export type MpRequestLineInput = z.infer<typeof mpRequestLineSchema>;
export type MpRequestCreateInput = z.infer<typeof mpRequestCreateSchema>;
export type MpRequestUpdateInput = z.infer<typeof mpRequestUpdateSchema>;
