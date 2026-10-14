"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";

import { account, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError, pgErrorCode } from "@/lib/db-errors";
import { requireHO } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import {
  fieldErrorsFrom,
  GENERIC_ERROR,
} from "@/lib/action-state";
import {
  deleteUserSessions,
  setCredentialPassword,
} from "@/lib/credential-store";
import {
  parseUserCreate,
  parseUserUpdate,
  userPasswordSchema,
} from "@/lib/validators";

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  siteId?: string | null;
}): Promise<ActionState> {
  await requireHO();

  const parsed = parseUserCreate(input);
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
    if (pgErrorCode(err) === "23503") {
      // The only FK here is siteId → site.
      return { ok: false, fieldErrors: { siteId: "Selected site no longer exists" } };
    }
    const mapped = mapDbError(err, { kind: "email" });
    if (mapped) return { ok: false, fieldErrors: { email: mapped } };
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
    if (pgErrorCode(err) === "23503") {
      // The only FK here is siteId → site.
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

  // Sessions must be wiped in both directions: on deactivation, to kill
  // live logins; on reactivation, so tokens minted while the user was
  // inactive (e.g. if they lapsed mid-session) can't resurrect.
  await deleteUserSessions(id);

  revalidatePath("/users");
  return { ok: true };
}
