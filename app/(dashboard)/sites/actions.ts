"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { site, siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/lib/db-errors";
import { requireSuperadmin } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { siteCreateSchema, siteUpdateSchema } from "@/lib/validators";

// Maps a driver error to the action result shape; mapDbError returns null for
// anything unexpected, so fall back to a generic message.
function dbResult(err: unknown): ActionState {
  const mapped = mapDbError(err, { kind: "site-name" });
  if (mapped) return { ok: false, message: mapped };
  return { ok: false, message: GENERIC_ERROR };
}

export async function createSite(name: string): Promise<ActionState> {
  await requireSuperadmin();

  const parsed = siteCreateSchema.safeParse({ name });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    await db.insert(site).values(parsed.data);
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/sites");
  return { ok: true };
}

export async function updateSite(
  id: string,
  input: { name: string; isActive: boolean },
): Promise<ActionState> {
  await requireSuperadmin();

  const parsed = siteUpdateSchema.safeParse({ ...input, id });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { name, isActive } = parsed.data;

  try {
    const updated = await db
      .update(site)
      .set({ name, isActive })
      .where(eq(site.id, parsed.data.id))
      .returning({ id: site.id });
    if (updated.length === 0) {
      return { ok: false, message: "Site not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/sites");
  return { ok: true };
}

export async function toggleSite(id: string): Promise<ActionState> {
  await requireSuperadmin();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid site id." };
  }

  try {
    const toggled = await db
      .update(site)
      .set({ isActive: sql`not ${site.isActive}` })
      .where(eq(site.id, id))
      .returning({ isActive: site.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Site not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/sites");
  return { ok: true };
}

// Sites unregister only when nothing references them. Guards run in order:
// locations first, then both flavors of user binding.
export async function deleteSite(id: string): Promise<ActionState> {
  await requireSuperadmin();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid site id." };
  }

  // (a) Locations under the site.
  const [location] = await db
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(eq(siteLocation.siteId, id))
    .limit(1);
  if (location) {
    return { ok: false, message: "Locations still exist under this site" };
  }

  // (b) Users bound directly to the site.
  const [bound] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.siteId, id))
    .limit(1);
  if (bound) {
    return { ok: false, message: "Users are still bound to this site" };
  }

  // (c) Users bound to any location under the site: a single join, since the
  // FK guard alone would only report the first offending row.
  const [boundLocation] = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    .where(eq(siteLocation.siteId, id))
    .limit(1);
  if (boundLocation) {
    return { ok: false, message: "Users are still bound to this site" };
  }

  try {
    await db.delete(site).where(eq(site.id, id));
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/sites");
  return { ok: true };
}
