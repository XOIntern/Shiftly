"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { account, siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError, pgErrorCode } from "@/error/db-errors";
import { canManageActorTarget } from "@/lib/scope";
import type { Role } from "@/types/domain";
import { requireHO } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import {
  deleteUserSessions,
  setCredentialPassword,
} from "@/lib/credential-store";
import {
  parseUserCreate,
  parseUserUpdate,
  userPasswordSchema,
} from "@/validation/user";

// Loads a management target and applies the shared permission gate. The
// target's site for the gate comes from the bound location (admins only);
// every other role targets no site.
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
    .where(and(eq(user.id, id), isNull(user.deletedAt)))
    .limit(1);

  if (!target) {
    return { ok: false, message: "User not found." };
  }

  if (
    !canManageActorTarget(actor, {
      role: target.role,
      locationSiteId: target.locationSiteId,
    })
  ) {
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

// Maps a statement's 23503 to the field whose FK constraint fired. The
// fallback keeps the old role-driven routing for the site/location
// bindings (which carry no per-constraint message of their own here).
function fkFieldErrors(
  err: unknown,
  role: Role,
): { ok: false; fieldErrors: Record<string, string> } {
  // The final role's own binding FK fired: admins point at site_location,
  // ho rows at site. Superadmins carry no FK-bearing binding, so a 23503
  // there is impossible.
  return role === "ho"
    ? { ok: false, fieldErrors: { siteId: "Selected site no longer exists" } }
    : {
        ok: false,
        fieldErrors: {
          siteLocationId: "Selected location no longer exists",
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
      return fkFieldErrors(err, role);
    }
    const mapped = mapDbError(err, { kind: "email" });
    if (mapped) return { ok: false, fieldErrors: { email: mapped } };
    throw err;
  }

  revalidatePath("/dashboard/users");
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

  // An ho actor may not change the role, site or site_location — those stay
  // pinned to the target's current values, whatever the payload carried. A
  // superadmin actor may switch the role; the bindings follow the new one
  // (ho: siteId; admin: siteLocationId; superadmin: none).
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
      .set({
        name: parsed.data.name,
        role,
        siteId,
        siteLocationId,
      })
      .where(eq(user.id, id))
      .returning({ id: user.id });
    if (updated.length === 0) {
      return { ok: false, message: "User not found." };
    }
  } catch (err) {
    if (pgErrorCode(err) === "23503") {
      // The new FK constraints route per-constraint; anything else falls
      // back to the role-driven site/location messages (fkFieldErrors).
      return fkFieldErrors(err, role);
    }
    const mapped = mapDbError(err, { kind: "email" });
    return mapped
      ? { ok: false, message: mapped }
      : { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/users");
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

  // A new hash fences new logins only — every live session dies with it.
  await deleteUserSessions(id);

  revalidatePath("/dashboard/users");
  return { ok: true };
}

export async function setActive(
  id: string,
  isActive: boolean,
): Promise<ActionState> {
  const current = await requireHO();

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

  revalidatePath("/dashboard/users");
  return { ok: true };
}

// Bulk variant of setActive: same permission gate, one write. The batch
// contract is "do what you can": malformed ids are dropped, rows the actor
// cannot manage are skipped, and never deactivating yourself rides on the
// single-row rule (a ho's own row is already unmanageable; a superadmin's
// own row passes the gate, so it is excluded explicitly). The caller only
// learns a count — which rows were skipped is never part of the answer.
export async function setActiveBulk(
  ids: string[],
  isActive: boolean,
): Promise<ActionState> {
  const current = await requireHO();

  // user.id is a text column — better-auth ids are 32-char random strings,
  // not uuids, so a uuid check would reject every real account here. The
  // site_location join + permission gate below already fail closed on any
  // id that matches no row.
  const validIds = [...new Set(ids)].filter((id) => id.length > 0);
  if (validIds.length === 0) {
    return { ok: false, message: "No users selected." };
  }

  // Every requested target goes through the same site_location join and
  // permission gate the single-row path uses, so an ho can never widen its
  // batch past another site's rows — no matter what ids the client sent.
  const candidates = await db
    .select({
      id: user.id,
      role: user.role,
      siteId: user.siteId,
      siteLocationId: user.siteLocationId,
      locationSiteId: siteLocation.siteId,
    })
    .from(user)
    .leftJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    // Soft-deleted rows are invisible to the page; activating/deactivating
    // one would silently resurrect a hidden account's flag.
    .where(and(inArray(user.id, validIds), isNull(user.deletedAt)));

  const managed = candidates.filter(
    (target) =>
      canManageActorTarget(current, {
        role: target.role,
        locationSiteId: target.locationSiteId,
      }) &&
      (isActive || target.id !== current.id),
  );
  if (managed.length === 0) {
    revalidatePath("/dashboard/users");
    return { ok: true, applied: 0 };
  }

  let applied = 0;
  try {
    const updated = await db
      .update(user)
      .set({ isActive })
      // Same weld as deleteUser: a row deleted between the candidate select
      // and this write must not be resurrected by the bulk path.
      .where(
        and(
          inArray(
            user.id,
            managed.map((target) => target.id),
          ),
          isNull(user.deletedAt),
        ),
      )
      .returning({ id: user.id });

    // Session hygiene matches the single-row action on both directions.
    await Promise.all(updated.map((row) => deleteUserSessions(row.id)));
    applied = updated.length;
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/users");
  return { ok: true, applied };
}

// Bulk variant of deleteUser: the same weld as setActiveBulk (candidate
// select on live rows, per-row permission gate, self exclusion, a write
// WHERE that cannot resurrect a row deleted between select and update) and
// the same end state as deleteUser — deletedAt stamped, sessions evicted.
// Unlike setActiveBulk there is no isActive direction to respect; like
// deleteUser the action does not demand a prior deactivation, the UI
// toolbar does. The caller only learns a count.
export async function deleteUserBulk(ids: string[]): Promise<ActionState> {
  const current = await requireHO();

  // user.id is text (see setActiveBulk) — no uuid check, just non-empty.
  const validIds = [...new Set(ids)].filter((id) => id.length > 0);
  if (validIds.length === 0) {
    return { ok: false, message: "No users selected." };
  }

  const candidates = await db
    .select({
      id: user.id,
      role: user.role,
      siteId: user.siteId,
      siteLocationId: user.siteLocationId,
      locationSiteId: siteLocation.siteId,
    })
    .from(user)
    .leftJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    .where(and(inArray(user.id, validIds), isNull(user.deletedAt)));

  const managed = candidates.filter(
    (target) =>
      canManageActorTarget(current, {
        role: target.role,
        locationSiteId: target.locationSiteId,
      }) && target.id !== current.id,
  );
  if (managed.length === 0) {
    revalidatePath("/dashboard/users");
    return { ok: true, applied: 0 };
  }

  let applied = 0;
  try {
    const deleted = await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(
            user.id,
            managed.map((target) => target.id),
          ),
          isNull(user.deletedAt),
        ),
      )
      .returning({ id: user.id });

    // Session hygiene matches deleteUser: a soft-deleted account cannot
    // stay logged in.
    await Promise.all(deleted.map((row) => deleteUserSessions(row.id)));
    applied = deleted.length;
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/users");
  return { ok: true, applied };
}

// Soft-deletes a user: the row survives with a deleted_at stamp (its email
// frees up for reuse), the target's live sessions are evicted so the deleted
// account cannot stay logged in, and the shared gate keeps the actor inside
// its scope. An already-deleted target answers "User not found." like any
// missing row — no existence leak.
export async function deleteUser(id: string): Promise<ActionState> {
  const current = await requireHO();

  if (id === current.id) {
    return { ok: false, message: "You cannot delete your own account" };
  }

  const gated = await loadManagedTarget(current, id);
  if (!gated.ok) return { ok: false, message: gated.message };

  try {
    const updated = await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(and(eq(user.id, id), isNull(user.deletedAt)))
      .returning({ id: user.id });
    if (updated.length === 0) {
      return { ok: false, message: "User not found." };
    }
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }

  await deleteUserSessions(id);

  revalidatePath("/dashboard/users");
  return { ok: true };
}
