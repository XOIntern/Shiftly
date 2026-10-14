"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/lib/db-errors";
import { requireHO, type SessionUser } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { locationCreateSchema, locationUpdateSchema } from "@/lib/validators";
import { locationOwnedByActor } from "@/lib/location-scope";

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
  return actor.role === "superadmin" ? inputSiteId : (actor.siteId ?? undefined);
}

export async function createLocation(
  input: { siteId?: string; name: string; address: string },
): Promise<ActionState> {
  const actor = await requireHO();

  const parsed = locationCreateSchema.safeParse({
    siteId: effectiveSiteId(actor, input.siteId),
    name: input.name,
    address: input.address,
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
      address: parsed.data.address,
    });
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/locations");
  return { ok: true };
}

export async function updateLocation(
  id: string,
  input: { name: string; address: string; siteId?: string; isActive: boolean },
): Promise<ActionState> {
  const actor = await requireHO();

  const parsed = locationUpdateSchema.safeParse({
    id,
    siteId: effectiveSiteId(actor, input.siteId),
    name: input.name,
    address: input.address,
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
        address: parsed.data.address,
        // undefined for a superadmin edit without a siteId (keep the
        // current site); a ho always lands on their own site.
        siteId: parsed.data.siteId,
        isActive: parsed.data.isActive,
      })
      .where(eq(siteLocation.id, parsed.data.id))
      .returning({ id: siteLocation.id });
    if (updated.length === 0) {
      return { ok: false, message: "Location not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/locations");
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
      .where(eq(siteLocation.id, id))
      .returning({ isActive: siteLocation.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Location not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/locations");
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
  // caught by the driver-side FK as a backstop.
  const bound = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.siteLocationId, id))
    .limit(1);
  if (bound.length > 0) {
    return { ok: false, message: "Users are still bound to this location" };
  }

  try {
    await db.delete(siteLocation).where(eq(siteLocation.id, id));
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/locations");
  return { ok: true };
}
