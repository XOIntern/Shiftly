import { ROLES } from "../lib/scope";
import { z } from "zod";

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
  password: z
    .string()
    .min(15, "Password must be at least 15 characters")
    .max(200),
  role: z.enum(ROLES),
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid().optional(),
});

export const userCreateSchema = userBaseSchema.refine(roleBindingValid, {
  message: bindingMessage,
});

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
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(100),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current password.",
  });

export const userUpdateSchema = userBaseSchema
  .omit({ password: true, email: true })
  .extend({ id: z.string().min(1) })
  .refine(roleBindingValid, { message: bindingMessage });

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

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserPasswordInput = z.infer<typeof userPasswordSchema>;
