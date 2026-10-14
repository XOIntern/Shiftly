"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";

import { account, siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError, pgErrorCode } from "@/lib/db-errors";
import { canManageUser, type Role } from "@/lib/scope";
import { requireHO, type SessionUser } from "@/lib/session";
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

// Call-site guard for canManageUser: a malformed admin row (siteLocationId
// unresolvable) has no real site, so only a superadmin may touch it — it
// must not pass through canManageUser's null === null match for an equally
// malformed ho actor.
function canManage(
  actor: { role: Role; siteId: string | null },
  targetRole: Role,
  targetSiteId: string | null,
): boolean {
  if (targetRole === "admin" && targetSiteId === null) {
    return actor.role === "superadmin";
  }
  return canManageUser(actor, { role: targetRole, targetSiteId });
}

// Loads a management target and applies the shared permission gate. The
// target's site for canManageUser is the bound location's site (admins
// only); every other role targets no site.
async function loadManagedTarget(
  actor: SessionUser,
  id: string,
): Promise<
  | {
      ok: true;
      target: {
        role: Role;
        siteId: string | null;
        siteLocationId: string | null;
      };
    }
  | { ok: false; message: string }
> {
  const [target] = await db
    .select({
      role: user.role,
      siteId: user.siteId,
      siteLocationId: user.siteLocationId,
      locationSiteId: siteLocation.siteId,
    })
    .from(user)
    .leftJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    .where(eq(user.id, id))
    .limit(1);

  if (!target) {
    return { ok: false, message: "User not found." };
  }

  const targetSiteId =
    target.role === "admin" ? (target.locationSiteId ?? null) : null;
  if (!canManage(actor, target.role, targetSiteId)) {
    return { ok: false, message: "You cannot manage this user" };
  }

  return {
    ok: true,
    target: {
      role: target.role,
      siteId: target.siteId,
      siteLocationId: target.siteLocationId,
    },
  };
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  siteId?: string | null;
  siteLocationId?: string | null;
}): Promise<ActionState> {
  const actor = await requireHO();

  // HO actors provision admins only — the role is forced before parsing so
  // a tampered payload can't mint ho or superadmin accounts. The parsed
  // role below is the enum the insert uses, never the raw string input.
  const parsed = parseUserCreate({
    ...input,
    role: actor.role === "ho" ? "admin" : input.role,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { name, email, password, role } = parsed.data;
  // The schema strips every binding the role doesn't own, so these collapse
  // to the single binding the final role carries (both null for superadmin).
  const siteId = parsed.data.siteId ?? null;
  const siteLocationId = parsed.data.siteLocationId ?? null;

  if (actor.role === "ho") {
    if (!siteLocationId) {
      // Unreachable via the admin schema, which rejects a missing location.
      return {
        ok: false,
        fieldErrors: { siteLocationId: "Location must be in your site" },
      };
    }
    // An ho may only provision into its own site. A malformed ho row (no
    // siteId) matches no real location, which is the intended deny.
    const [location] = await db
      .select({ siteId: siteLocation.siteId })
      .from(siteLocation)
      .where(eq(siteLocation.id, siteLocationId))
      .limit(1);
    if (!location || location.siteId !== actor.siteId) {
      return {
        ok: false,
        fieldErrors: { siteLocationId: "Location must be in your site" },
      };
    }
  }

  // Better Auth's sign-up is disabled (disableSignUp: true in lib/auth.ts),
  // so provisioning replicates what the sign-up route writes (same
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
        siteLocationId,
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
      // The final role's own binding FK fired: admins point at
      // site_location, ho rows at site. Superadmins carry no FK-bearing
      // binding, so a 23503 there is impossible.
      return role === "ho"
        ? { ok: false, fieldErrors: { siteId: "Selected site no longer exists" } }
        : {
            ok: false,
            fieldErrors: {
              siteLocationId: "Selected location no longer exists",
            },
          };
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
  input: {
    name: string;
    role: string;
    siteId?: string | null;
    siteLocationId?: string | null;
  },
): Promise<ActionState> {
  const actor = await requireHO();

  const gated = await loadManagedTarget(actor, id);
  if (!gated.ok) return { ok: false, message: gated.message };
  const target = gated.target;

  const parsed = parseUserUpdate(id, input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // An ho actor may not change the role or binding — both stay pinned to
  // the target's current values, whatever the payload carried. A
  // superadmin actor may switch the role; the bindings follow the new one
  // (ho: siteId only; admin: siteLocationId only; superadmin: none).
  const role: Role = actor.role === "ho" ? target.role : parsed.data.role;
  const siteId = role === "ho" ? (parsed.data.siteId ?? null) : null;
  const siteLocationId =
    role !== "admin"
      ? null
      : actor.role === "ho"
        ? (target.siteLocationId ?? null)
        : (parsed.data.siteLocationId ?? null);

  try {
    const updated = await db
      .update(user)
      .set({ name: parsed.data.name, role, siteId, siteLocationId })
      .where(eq(user.id, id))
      .returning({ id: user.id });
    if (updated.length === 0) {
      return { ok: false, message: "User not found." };
    }
  } catch (err) {
    if (pgErrorCode(err) === "23503") {
      // Same binding-FK routing as createUser.
      return role === "ho"
        ? { ok: false, fieldErrors: { siteId: "Selected site no longer exists" } }
        : {
            ok: false,
            fieldErrors: {
              siteLocationId: "Selected location no longer exists",
            },
          };
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
  const actor = await requireHO();

  const parsed = userPasswordSchema.safeParse({ newPassword });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }
  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid user id." };
  }

  const gated = await loadManagedTarget(actor, id);
  if (!gated.ok) return { ok: false, message: gated.message };

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

  const gated = await loadManagedTarget(current, id);
  if (!gated.ok) return { ok: false, message: gated.message };

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
