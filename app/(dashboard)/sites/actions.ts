"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/lib/db-errors";
import { requireSuperadmin } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { siteCreateSchema, siteUpdateSchema } from "@/lib/validators";
import { deleteSiteGuarded } from "@/lib/site-delete";

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

// Sites unregister only when nothing references them. The guards and the
// DELETE share ONE transaction (issue #17 Task 2): a guard can never race
// the write, and any guard answer rolls nothing partial back. The FK
// backstop above stays as the catch afterwards.
export async function deleteSite(id: string): Promise<ActionState> {
  await requireSuperadmin();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid site id." };
  }

  let result: Awaited<ReturnType<typeof deleteSiteGuarded>>;
  try {
    result = await db.transaction((tx) => deleteSiteGuarded(tx, id));
  } catch (err) {
    return dbResult(err);
  }

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/sites");
  return { ok: true };
}
