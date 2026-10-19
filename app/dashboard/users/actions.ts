"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { account, department, siteLocation, user, workArea } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  mapDbError,
  pgErrorCode,
  pgErrorConstraint,
} from "@/lib/db-errors";
import { canManageActorTarget, type Role } from "@/lib/scope";
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
        departmentId: string | null;
        workAreaId: string | null;
      };
    }
  | { ok: false; message: string }
> {
  const [target] = await db
    .select({
      role: user.role,
      siteId: user.siteId,
      siteLocationId: user.siteLocationId,
      departmentId: user.departmentId,
      workAreaId: user.workAreaId,
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
      departmentId: target.departmentId,
      workAreaId: target.workAreaId,
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
  const constraint = pgErrorConstraint(err);
  if (constraint === "user_department_id_department_id_fk") {
    return {
      ok: false,
      fieldErrors: { departmentId: "Selected department no longer exists" },
    };
  }
  if (constraint === "user_work_area_id_work_area_id_fk") {
    return {
      ok: false,
      fieldErrors: { workAreaId: "Selected work area no longer exists" },
    };
  }
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

// Verifies a department id a client may bind: it must exist un-deleted and
// (for a site-scoped actor) sit inside that actor's site. A deleted or
// foreign department reads as "must belong to your site", matching the
// work-areas actions' scope error for the same field.
async function departmentAllowsBinding(
  departmentId: string,
  siteId: string | null,
): Promise<boolean> {
  const [dept] = await db
    .select({ siteId: department.siteId })
    .from(department)
    .where(and(eq(department.id, departmentId), isNull(department.deletedAt)))
    .limit(1);
  return !!dept && dept.siteId === siteId;
}

// Superadmin actors carry no department net — the user_department FK's
// existence-only check would silently persist a binding to a physically
// present but soft-deleted row. This load mirrors the ho path's deletedAt
// weld: null → the row doesn't exist and the FK's 23503 carries its own
// "no longer exists" message; a found-but-deleted row answers before the
// FK with that same message.
const DEPARTMENT_GONE_ERROR = {
  ok: false as const,
  fieldErrors: {
    departmentId: "Selected department no longer exists" as const,
  },
};

const DEPARTMENT_PAIRING_FIELD_ERRORS = {
  departmentId: "Department must belong to your site",
} as const;

// Departments are still site-scoped for superadmin actors: a plain FK
// would otherwise let a target's department silently pull from another
// site than the one the target's own binding points at. Same reuse as the
// ho path's pairing error — the field error the target's site mismatch
// already answers with.
function departmentPairingError() {
  return { ok: false, fieldErrors: DEPARTMENT_PAIRING_FIELD_ERRORS };
}

async function loadDepartmentBinding(
  departmentId: string,
): Promise<{ deleted: boolean; siteId: string } | null> {
  const [dept] = await db
    .select({ deletedAt: department.deletedAt, siteId: department.siteId })
    .from(department)
    .where(eq(department.id, departmentId))
    .limit(1);
  return dept
    ? { deleted: dept.deletedAt !== null, siteId: dept.siteId }
    : null;
}

// The site a department binding must pair with: an ho target's site is the
// ho row's own binding; an admin target's is the site of the location the
// target is (or will be) bound to. Returns null when the role carries no
// department-shaped binding subtree to pair against.
async function targetPairingSiteId(
  role: Role,
  siteId: string | null,
  siteLocationId: string | null,
): Promise<string | null> {
  if (role === "ho") return siteId;
  if (role === "admin" && siteLocationId) {
    const [loc] = await db
      .select({ siteId: siteLocation.siteId })
      .from(siteLocation)
      .where(eq(siteLocation.id, siteLocationId))
      .limit(1);
    return loc?.siteId ?? null;
  }
  return null;
}


// Loads a work area for the pairing net below (un-scoped: soft-deleted rows
// are looked up too, since the FK sees them). null → the row doesn't exist
// and the statement's own FK carries the "no longer exists" message; a
// deleted:true row is reported so the caller can answer with that same
// message before the FK can silently bind it. A location mismatch answers
// at the field instead (the plain FK only checks existence — a
// cross-location pairing would otherwise persist silently).
async function loadWorkAreaBinding(
  workAreaId: string,
): Promise<{ siteLocationId: string; deleted: boolean } | null> {
  const [wa] = await db
    .select({
      siteLocationId: workArea.siteLocationId,
      deletedAt: workArea.deletedAt,
    })
    .from(workArea)
    .where(eq(workArea.id, workAreaId))
    .limit(1);
  return wa ? { siteLocationId: wa.siteLocationId, deleted: wa.deletedAt !== null } : null;
}

// A work area the net's lookup found physically present but soft-deleted
// (or a pairing mismatches) → "no longer exists" instead of letting the
// FK's existence-only check persist the binding silently.
const WORK_AREA_GONE_ERROR = {
  ok: false as const,
  fieldErrors: {
    workAreaId: "Selected work area no longer exists" as const,
  },
};

const WORK_AREA_PAIRING_FIELD_ERRORS = {
  workAreaId: "Work area must belong to the selected location",
} as const;

function workAreaPairingError() {
  return { ok: false, fieldErrors: WORK_AREA_PAIRING_FIELD_ERRORS };
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  siteId?: string | null;
  siteLocationId?: string | null;
  departmentId?: string | null;
  workAreaId?: string | null;
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

  // Departments are site-scoped: an ho actor's pick must live in their
  // own site (soft-deleted departments are not bindable). Superadmin
  // actors may pick any department — but a physically present
  // soft-deleted row is caught by the load below, and the department's
  // site must pair with the target's own binding site (the FK checks
  // existence only, so a cross-site pairing would otherwise persist
  // silently).
  const departmentId = parsed.data.departmentId ?? null;
  if (actor.role === "ho" && departmentId) {
    if (!(await departmentAllowsBinding(departmentId, actor.siteId))) {
      return {
        ok: false,
        fieldErrors: { departmentId: "Department must belong to your site" },
      };
    }
  } else if (actor.role === "superadmin" && departmentId) {
    const bound = await loadDepartmentBinding(departmentId);
    if (bound?.deleted) return DEPARTMENT_GONE_ERROR;
    if (bound) {
      const requiredSiteId = await targetPairingSiteId(
        role,
        siteId,
        siteLocationId,
      );
      if (requiredSiteId && bound.siteId !== requiredSiteId) {
        return departmentPairingError();
      }
    }
  }

  // An ho actor never sets a work area — that binding belongs to admins
  // and is managed by superadmins; the raw client value is dropped here
  // (the validator keeps workAreaId for admin targets regardless of actor).
  // A superadmin's pick must pair with the admin's location.
  const workAreaId = actor.role === "ho" ? null : (parsed.data.workAreaId ?? null);
  if (workAreaId && role === "admin") {
    const bound = await loadWorkAreaBinding(workAreaId);
    if (bound) {
      if (bound.deleted) return WORK_AREA_GONE_ERROR;
      if (bound.siteLocationId !== siteLocationId) {
        return workAreaPairingError();
      }
    }
    // bound === null (row not present at all) → let the statement's own FK answer.
  }

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
        departmentId,
        workAreaId,
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
    departmentId?: string | null;
    workAreaId?: string | null;
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
  // (ho: siteId + optional department; admin: siteLocationId + optional
  // department/work area; superadmin: none). An ho actor's department pick
  // IS read (verified below against the actor's site — this is issue #66's
  // golden path: an ho editing an admin picks a department and it
  // persists); only the work area stays pinned to the target (an ho never
  // sets one).
  const role: Role = actor.role === "ho" ? target.role : parsed.data.role;
  const siteId = role === "ho" ? (parsed.data.siteId ?? null) : null;
  const siteLocationId =
    role !== "admin"
      ? null
      : actor.role === "ho"
        ? (target.siteLocationId ?? null)
        : (parsed.data.siteLocationId ?? null);
  // Departments/work areas: on an ho or admin target the department may
  // be set (read from the actor-verified input); a work area belongs to
  // admins alone and stays pinned to the target's current value.
  // Superadmin targets carry neither.
  const departmentId =
    role === "superadmin"
      ? null
      : actor.role === "ho"
        ? (parsed.data.departmentId ?? null)
        : (parsed.data.departmentId ?? null);
  const workAreaId =
    role !== "admin"
      ? null
      : actor.role === "ho"
        ? (target.workAreaId ?? null)
        : (parsed.data.workAreaId ?? null);

  // Same pairing net for edits: an admin target's work area must hang off
  // its (input-)site_location. Scoped to superadmin actors only — an ho
  // actor's workAreaId is pinned to the target's current value, so the net
  // would reject every edit of a drifted/pre-existing row with an error
  // the ho cannot resolve (the select is never rendered for them).
  if (actor.role === "superadmin" && workAreaId && siteLocationId) {
    const bound = await loadWorkAreaBinding(workAreaId);
    if (bound) {
      if (bound.deleted) return WORK_AREA_GONE_ERROR;
      if (bound.siteLocationId !== siteLocationId) {
        return workAreaPairingError();
      }
    }
  }

  // An ho actor's department pick is site-scoped, exactly like on create:
  // a foreign (or soft-deleted) pick answers at the field.
  if (actor.role === "ho" && departmentId) {
    if (!(await departmentAllowsBinding(departmentId, actor.siteId))) {
      return {
        ok: false,
        fieldErrors: { departmentId: "Department must belong to your site" },
      };
    }
  }

  // Same weld for the superadmin edit path (mirrors the work area net
  // above; the ho path's site weld already covers deleted rows). The
  // department's site must also pair with the target's binding site —
  // same reuse of "must belong to your site" as the ho path's error.
  if (actor.role === "superadmin" && departmentId) {
    const bound = await loadDepartmentBinding(departmentId);
    if (bound?.deleted) return DEPARTMENT_GONE_ERROR;
    if (bound) {
      const requiredSiteId = await targetPairingSiteId(
        role,
        siteId,
        siteLocationId,
      );
      if (requiredSiteId && bound.siteId !== requiredSiteId) {
        return departmentPairingError();
      }
    }
  }

  try {
    const updated = await db
      .update(user)
      .set({
        name: parsed.data.name,
        role,
        siteId,
        siteLocationId,
        departmentId,
        workAreaId,
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
    return mapped ? { ok: false, message: mapped } : { ok: false, message: GENERIC_ERROR };
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
      }) && (isActive || target.id !== current.id),
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
