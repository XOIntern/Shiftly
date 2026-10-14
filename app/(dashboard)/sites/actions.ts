"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { site, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/lib/db-errors";
import { requireHO } from "@/lib/session";
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

export async function createSite(
  clientId: string,
  name: string,
  location: string,
): Promise<ActionState> {
  await requireHO();

  const parsed = siteCreateSchema.safeParse({ clientId, name, location });
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
  input: { name: string; location: string; clientId: string; isActive: boolean },
): Promise<ActionState> {
  await requireHO();

  const parsed = siteUpdateSchema.safeParse({ ...input, id });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { name, location, clientId, isActive } = parsed.data;

  try {
    const updated = await db
      .update(site)
      .set({ name, location, clientId, isActive })
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
  await requireHO();

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

export async function deleteSite(id: string): Promise<ActionState> {
  await requireHO();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid site id." };
  }

  // Workers tables don't exist yet; until they do, only user rows can block a
  // delete. The driver-side FK guard still catches anything else.
  const bound = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.siteId, id))
    .limit(1);
  if (bound.length > 0) {
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
