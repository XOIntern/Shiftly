"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";

import { account, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/lib/db-errors";
import { requireHO } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import {
  deleteUserSessions,
  setCredentialPassword,
} from "@/lib/credential-store";
import {
  parseUserUpdate,
  userCreateSchema,
  userPasswordSchema,
} from "@/lib/validators";

const GENERIC_ERROR = "Something went wrong. Please try again.";

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  siteId?: string | null;
}): Promise<ActionState> {
  await requireHO();

  const parsed = userCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { name, email, password, role } = parsed.data;
  const siteId = role === "site_admin" ? (parsed.data.siteId ?? null) : null;

  // Better Auth's sign-up is disabled (disableSignUp: true in lib/auth.ts),
  // so HO provisioning replicates what the sign-up route writes (same
  // mechanism as scripts/seed-admin.ts): user + credential account with the
  // password hashed via the `hashPassword` Better Auth's sign-in verifies
  // against (dist/api/routes/sign-in.mjs:326-335,
  // dist/context/create-context.mjs:183).
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        name,
        // Better Auth's sign-in queries emails lowercased
        // (dist/api/routes/sign-in.mjs:317); store normalized.
        email: email.toLowerCase(),
        emailVerified: true,
        role,
        siteId,
        isActive: true,
      });
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      });
    });
  } catch (err) {
    const mapped = mapDbError(err, { kind: "email" });
    if (mapped) return { ok: false, fieldErrors: { email: mapped } };
    // The only other FK here is siteId → site.
    if ((err as { code?: string }).code === "23503") {
      return { ok: false, fieldErrors: { siteId: "Selected site no longer exists" } };
    }
    throw err;
  }

  revalidatePath("/users");
  return { ok: true };
}

export async function updateUser(
  id: string,
  input: { name: string; role: string; siteId?: string | null },
): Promise<ActionState> {
  await requireHO();

  const parsed = parseUserUpdate(id, input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { name, role } = parsed.data;
  // Moving a user back to ho clears their site assignment.
  const siteId = role === "site_admin" ? (parsed.data.siteId ?? null) : null;

  try {
    const updated = await db
      .update(user)
      .set({ name, role, siteId })
      .where(eq(user.id, id))
      .returning({ id: user.id });
    if (updated.length === 0) {
      return { ok: false, message: "User not found." };
    }
  } catch (err) {
    // The only FK here is siteId → site.
    if ((err as { code?: string }).code === "23503") {
      return { ok: false, fieldErrors: { siteId: "Selected site no longer exists" } };
    }
    const mapped = mapDbError(err, { kind: "email" });
    return mapped ? { ok: false, message: mapped } : { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/users");
  return { ok: true };
}

export async function resetPassword(
  id: string,
  newPassword: string,
): Promise<ActionState> {
  await requireHO();

  const parsed = userPasswordSchema.safeParse({ newPassword });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid user id." };
  }

  try {
    const updated = await setCredentialPassword(id, parsed.data.newPassword);
    if (updated === 0) {
      return { ok: false, message: "User not found." };
    }
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/users");
  return { ok: true };
}

export async function setActive(
  id: string,
  isActive: boolean,
): Promise<ActionState> {
  const current = await requireHO();

  const idParsed = z.uuid().safeParse(id);
  if (!idParsed.success) {
    return { ok: false, message: "Invalid user id." };
  }

  if (!isActive && id === current.id) {
    return { ok: false, message: "You cannot deactivate your own account" };
  }

  try {
    const updated = await db
      .update(user)
      .set({ isActive })
      .where(eq(user.id, id))
      .returning({ id: user.id });
    if (updated.length === 0) {
      return { ok: false, message: "User not found." };
    }
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  // Killing the target's Better Auth sessions only matters on deactivation.
  if (!isActive) {
    await deleteUserSessions(id);
  }

  revalidatePath("/users");
  return { ok: true };
}
