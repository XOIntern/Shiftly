"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/lib/db-errors";
import { requireHO } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { locationCreateSchema, locationUpdateSchema } from "@/validation/validators";
import {
  locationMutationWhere,
  locationOwnedByActor,
  locationBulkMutationWhere,
} from "@/lib/location-scope";

// Maps a driver error to the action result shape; mapDbError returns null for
// anything unexpected, so fall back to a generic message.
function dbResult(err: unknown): ActionState {
  const mapped = mapDbError(err, { kind: "location-name" });
  if (mapped) return { ok: false, message: mapped };
  return { ok: false, message: GENERIC_ERROR };
}

// HO scoping (issue #13): a ho's effective siteId is their own binding —
// anything the client sent is ignored. A superadmin keeps the input value;
// an invalid one is caught by the site_id FK.
function effectiveSiteId(
  actor: SessionUser,
  inputSiteId: string | undefined,
): string | undefined {
  return actor.role === "superadmin"
    ? inputSiteId
    : (actor.siteId ?? undefined);
}

export async function createLocation(input: {
  siteId?: string;
  name: string;
}): Promise<ActionState> {
  const actor = await requireHO();

  const parsed = locationCreateSchema.safeParse({
    siteId: effectiveSiteId(actor, input.siteId),
    name: input.name,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Unreachable from the dialogs (their site select forces a pick), but a
  // direct caller without a siteId surfaces a per-field error instead of a
  // DB not-null failure. A ho without a site binding lands here too.
  if (!parsed.data.siteId) {
    return { ok: false, fieldErrors: { siteId: "Site is required." } };
  }

  try {
    await db.insert(siteLocation).values({
      siteId: parsed.data.siteId,
      name: parsed.data.name,
    });
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/locations");
  return { ok: true };
}

export async function updateLocation(
  id: string,
  input: { name: string; siteId?: string; isActive: boolean },
): Promise<ActionState> {
  const actor = await requireHO();

  const parsed = locationUpdateSchema.safeParse({
    id,
    siteId: effectiveSiteId(actor, input.siteId),
    name: input.name,
    isActive: input.isActive,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Ownership before any write: for an ho the row must already sit in their
  // site, or a foreign location would be re-parented in. This must run
  // before the update whose set() pins siteId to the actor's site.
  if (!(await locationOwnedByActor(actor, parsed.data.id))) {
    return { ok: false, message: "Location not found." };
  }

  try {
    const updated = await db
      .update(siteLocation)
      .set({
        name: parsed.data.name,
        // undefined for a superadmin edit without a siteId (keep the
        // current site); a ho always lands on their own site.
        siteId: parsed.data.siteId,
        isActive: parsed.data.isActive,
      })
      // Weld (issue #17 Task 2): the ownership predicate rides inside the
      // mutating WHERE, so the check above is redundancy, not the last
      // line of defense.
      .where(locationMutationWhere(actor, parsed.data.id))
      .returning({ id: siteLocation.id });
    if (updated.length === 0) {
      return { ok: false, message: "Location not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/locations");
  return { ok: true };
}

export async function toggleLocation(id: string): Promise<ActionState> {
  const actor = await requireHO();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid location id." };
  }

  if (!(await locationOwnedByActor(actor, id))) {
    return { ok: false, message: "Location not found." };
  }

  try {
    const toggled = await db
      .update(siteLocation)
      .set({ isActive: sql`not ${siteLocation.isActive}` })
      .where(locationMutationWhere(actor, id))
      .returning({ isActive: siteLocation.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Location not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/locations");
  return { ok: true };
}

export async function deleteLocation(id: string): Promise<ActionState> {
  const actor = await requireHO();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid location id." };
  }

  // Foreign locations answer "not found." — never "users are still bound",
  // which would leak that the row exists.
  if (!(await locationOwnedByActor(actor, id))) {
    return { ok: false, message: "Location not found." };
  }

  // Location admins are the rows that bind a site_location; anything else is
  // caught by the driver-side FK as a backstop. Only LIVE users count — an
  // already soft-deleted user must not resurrect its own binding.
  const bound = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.siteLocationId, id), isNull(user.deletedAt)))
    .limit(1);
  if (bound.length > 0) {
    return { ok: false, message: "Users are still bound to this location" };
  }

  try {
    await db
      .update(siteLocation)
      .set({ deletedAt: new Date() })
      // Weld (issue #17 Task 2): same ownership-in-WHERE as update/toggle,
      // with the bound-users pre-check above intact for its message.
      .where(locationMutationWhere(actor, id));
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/locations");
  return { ok: true };
}

// Bulk subset-write of location.isActive. "Do what you can": malformed ids
// are dropped and the ownership weld rides inside the mutating WHERE, so an
// ho can never widen its batch past its own site no matter what ids arrive.
export async function setActiveBulk(
  ids: string[],
  isActive: boolean,
): Promise<ActionState> {
  const actor = await requireHO();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No locations selected." };
  }

  try {
    const updated = await db
      .update(siteLocation)
      .set({ isActive })
      .where(locationBulkMutationWhere(actor, validIds))
      .returning({ id: siteLocation.id });
    revalidatePath("/dashboard/locations");
    return { ok: true, applied: updated.length };
  } catch (err) {
    return dbResult(err);
  }
}

// Bulk location unregistration. Rows with LIVE admins still bound are
// skipped (not fatal) with the same guard message the single-row path
// gives: the bound check rides the same ownership WHERE, so foreign
// locations can never leak into either count. The write soft-deletes —
// deleted_at is set, the row itself stays.
export async function deleteBulk(ids: string[]): Promise<ActionState> {
  const actor = await requireHO();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No locations selected." };
  }

  // Admin-bound rows among the requested set, scoped by the same weld —
  // this select maps 1:1 onto "these rows will refuse to delete."
  const boundRows = await db
    .select({ id: user.siteLocationId })
    .from(user)
    .innerJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    .where(
      and(locationBulkMutationWhere(actor, validIds), isNull(user.deletedAt)),
    );

  const boundIds = new Set(
    boundRows
      .filter((row): row is { id: string } => row.id !== null)
      .map((row) => row.id),
  );

  try {
    const deleted = await db
      .update(siteLocation)
      .set({ deletedAt: new Date() })
      .where(
        locationBulkMutationWhere(
          actor,
          validIds.filter((id) => !boundIds.has(id)),
        ),
      );
    const result: ActionState = {
      ok: true,
      applied: deleted.rowCount ?? 0,
      blocked: boundIds.size,
    };
    if (boundIds.size > 0) {
      result.message = `${boundIds.size} location${boundIds.size === 1 ? "" : "s"} skipped: Users are still bound to this location`;
    }
    revalidatePath("/dashboard/locations");
    return result;
  } catch (err) {
    return dbResult(err);
  }
}
