"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/error/db-errors";
import { requireSuperadmin } from "@/lib/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { siteCreateSchema, siteUpdateSchema } from "@/validation/site";
import { deleteSiteGuarded } from "@/lib/site-delete";
import { purgeSiteGuarded } from "@/lib/site-purge";
import { restoreSiteGuarded } from "@/lib/site-restore";

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

  revalidatePath("/dashboard/sites");
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

  revalidatePath("/dashboard/sites");
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

  revalidatePath("/dashboard/sites");
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

  revalidatePath("/dashboard/sites");
  return { ok: true };
}

// Permanent delete of a soft-deleted site. Guards and writes share one
// transaction (lib/site-purge.ts); history refuses, and the FK backstop is
// mapped by dbResult.
export async function purgeSite(id: string): Promise<ActionState> {
  await requireSuperadmin();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid site id." };
  }

  let result: Awaited<ReturnType<typeof purgeSiteGuarded>>;
  try {
    result = await db.transaction((tx) => purgeSiteGuarded(tx, id));
  } catch (err) {
    return dbResult(err);
  }

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/sites");
  return { ok: true };
}

// Brings a soft-deleted site back (lib/site-restore.ts). Only the site row
// returns, inactive; a name now taken by a live site refuses with the
// duplicate message, through the guard or through the unique-index backstop.
export async function restoreSite(id: string): Promise<ActionState> {
  await requireSuperadmin();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid site id." };
  }

  let result: Awaited<ReturnType<typeof restoreSiteGuarded>>;
  try {
    result = await db.transaction((tx) => restoreSiteGuarded(tx, id));
  } catch (err) {
    return dbResult(err);
  }

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/sites");
  return { ok: true };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Runs one guarded write per selected site, each in its OWN transaction: a
// refusal or a driver error on one site (a unique-index clash, a FK) must not
// undo the sites that went through. Malformed ids are dropped, and a partial
// write is still a full success — applied counts the sites that went through,
// blocked the refused, and the FIRST refusal's message rides back so the UI
// can say why rows were skipped.
async function runPerSite(
  ids: string[],
  guarded: (
    tx: Tx,
    id: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>,
): Promise<ActionState> {
  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No sites selected." };
  }

  let applied = 0;
  let blocked = 0;
  let firstBlocker: string | undefined;
  for (const id of validIds) {
    let result: { ok: true } | { ok: false; message: string };
    try {
      result = await db.transaction((tx) => guarded(tx, id));
    } catch (err) {
      result = {
        ok: false,
        message: dbResult(err).message ?? GENERIC_ERROR,
      };
    }
    if (result.ok) {
      applied += 1;
    } else {
      blocked += 1;
      firstBlocker ??= result.message;
    }
  }

  revalidatePath("/dashboard/sites");
  return {
    ok: true,
    applied,
    blocked,
    message:
      blocked > 0
        ? `${blocked} site${blocked === 1 ? "" : "s"} skipped: ${firstBlocker}`
        : undefined,
  };
}

// Bulk restore of soft-deleted sites (superadmin only).
export async function restoreBulk(ids: string[]): Promise<ActionState> {
  await requireSuperadmin();
  return runPerSite(ids, restoreSiteGuarded);
}

// Bulk permanent delete of soft-deleted sites (superadmin only). Each site
// runs the same guarded purge as purgeSite; one with history is skipped.
export async function purgeBulk(ids: string[]): Promise<ActionState> {
  await requireSuperadmin();
  return runPerSite(ids, purgeSiteGuarded);
}

// Bulk subset-write of site.isActive (superadmin only). "Do what you can":
// malformed ids are dropped, and only requested ids are touched — a partial
// write is still a full success, the caller just reads the count back.
export async function setActiveBulk(
  ids: string[],
  isActive: boolean,
): Promise<ActionState> {
  await requireSuperadmin();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No sites selected." };
  }

  try {
    const updated = await db
      .update(site)
      .set({ isActive })
      .where(inArray(site.id, validIds))
      .returning({ id: site.id });
    revalidatePath("/dashboard/sites");
    return { ok: true, applied: updated.length };
  } catch (err) {
    return dbResult(err);
  }
}

// Bulk site unregistration. Each id runs through the same guarded DELETE
// the single-row path uses, inside one transaction, so guards can never
// race a write. A partially guarded site is a skipped row, not a fatal
// error: applied counts the unregistered, blocked the refused, and the
// FIRST guard message rides back so the UI can say why rows were skipped.
export async function deleteBulk(ids: string[]): Promise<ActionState> {
  await requireSuperadmin();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No sites selected." };
  }

  let applied = 0;
  let blocked = 0;
  let firstBlocker: string | undefined;
  try {
    await db.transaction(async (tx) => {
      for (const id of validIds) {
        const result = await deleteSiteGuarded(tx, id);
        if (result.ok) {
          applied += 1;
        } else {
          blocked += 1;
          firstBlocker ??= result.message;
        }
      }
    });
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/sites");
  return {
    ok: true,
    applied,
    blocked,
    message:
      blocked > 0
        ? `${blocked} site${blocked === 1 ? "" : "s"} skipped: ${firstBlocker}`
        : undefined,
  };
}
