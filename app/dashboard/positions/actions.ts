"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { position, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError, pgErrorCode } from "@/lib/db-errors";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import {
  positionCreateSchema,
  positionUpdateSchema,
} from "@/schema/validators";
import {
  positionBulkMutationWhere,
  positionMutationWhere,
  positionOwnedByActor,
} from "@/lib/position-scope";

// Maps a driver error to the action result shape; mapDbError returns null for
// anything unexpected, so fall back to a generic message.
function dbResult(err: unknown): ActionState {
  const mapped = mapDbError(err, { kind: "position-name" });
  if (mapped) return { ok: false, message: mapped };
  return { ok: false, message: GENERIC_ERROR };
}

// The only FK on position (site_id → site) carries ON DELETE restrict, so
// a site row that vanished between the pick and the write surfaces as
// 23503/23001. Any other firing is a race — this is the net.
const FK_MESSAGE = "Selected site no longer exists";

function fkResult(err: unknown): ActionState {
  const code = pgErrorCode(err);
  if (code === "23503" || code === "23001") {
    return { ok: false, message: FK_MESSAGE };
  }
  return dbResult(err);
}

// siteId is NEVER trusted from the client for ho/admin: an ho is pinned to
// their own site, an admin to the site of their site_location binding
// (resolved post-parse — see effectiveSiteId). A superadmin keeps the input
// pick.
function clientSiteId(
  actor: SessionUser,
  inputSiteId: string | undefined,
): string | undefined {
  return actor.role === "admin"
    ? undefined
    : actor.role === "ho"
      ? (actor.siteId ?? undefined)
      : inputSiteId;
}

// An admin's binding site: their site_location must exist and be live for
// the position to parent onto its site. Mirrors the work-area derivation's
// live-row weld.
async function adminBindingSiteId(
  actor: SessionUser,
): Promise<string | undefined> {
  if (!actor.siteLocationId) return undefined;
  const [binding] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(
      and(
        eq(siteLocation.id, actor.siteLocationId),
        isNull(siteLocation.deletedAt),
      ),
    )
    .limit(1);
  return binding?.siteId;
}

export async function createPosition(input: {
  siteId?: string;
  name: string;
}): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = positionCreateSchema.safeParse({
    siteId: clientSiteId(actor, input.siteId),
    name: input.name,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Admin: the pick is their binding's site, resolved server-side — a dead
  // or missing binding fails closed at the field.
  let siteId = parsed.data.siteId;
  if (actor.role === "admin") {
    siteId = await adminBindingSiteId(actor);
    if (!siteId) {
      return { ok: false, fieldErrors: { siteId: "Site not found." } };
    }
  }
  // An unbound ho (or a superadmin pick that never arrived) fails closed at
  // the field, not at the DB.
  if (!siteId) {
    return { ok: false, fieldErrors: { siteId: "Site is required" } };
  }

  try {
    await db.insert(position).values({
      siteId,
      name: parsed.data.name,
    });
  } catch (err) {
    return fkResult(err);
  }

  revalidatePath("/dashboard/positions");
  return { ok: true };
}

export async function updatePosition(
  id: string,
  input: {
    name: string;
    isActive: boolean;
  },
): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = positionUpdateSchema.safeParse({
    id,
    name: input.name,
    isActive: input.isActive,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Ownership before any write: the row must already sit in the actor's
  // scope, or a foreign position would be rewritten. A position never
  // moves sites — only its name and status are editable.
  if (!(await positionOwnedByActor(actor, parsed.data.id))) {
    return { ok: false, message: "Position not found." };
  }

  try {
    const updated = await db
      .update(position)
      .set({
        name: parsed.data.name,
        isActive: parsed.data.isActive,
      })
      // Weld: the ownership predicate rides inside the mutating WHERE.
      .where(positionMutationWhere(actor, parsed.data.id))
      .returning({ id: position.id });
    if (updated.length === 0) {
      return { ok: false, message: "Position not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/positions");
  return { ok: true };
}

export async function togglePosition(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid position id." };
  }

  try {
    const toggled = await db
      .update(position)
      .set({ isActive: sql`not ${position.isActive}` })
      .where(positionMutationWhere(actor, id))
      .returning({ isActive: position.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Position not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/positions");
  return { ok: true };
}

export async function deletePosition(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid position id." };
  }

  // Foreign positions answer "not found." — no scope leaks. The workers
  // bound-guard lands with the worker table; soft delete is direct today.
  if (!(await positionOwnedByActor(actor, id))) {
    return { ok: false, message: "Position not found." };
  }

  try {
    await db
      .update(position)
      .set({ deletedAt: new Date() })
      // Weld: same ownership-in-WHERE as update/toggle.
      .where(positionMutationWhere(actor, id));
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/positions");
  return { ok: true };
}

// Bulk subset-write of position.isActive. "Do what you can": malformed ids
// are dropped and the ownership weld rides inside the mutating WHERE, so an
// admin (or ho) can never widen its batch past its own scope no matter what
// ids arrive.
export async function setActiveBulk(
  ids: string[],
  isActive: boolean,
): Promise<ActionState> {
  const actor = await requireUser();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No positions selected." };
  }

  try {
    const updated = await db
      .update(position)
      .set({ isActive })
      .where(positionBulkMutationWhere(actor, validIds))
      .returning({ id: position.id });
    revalidatePath("/dashboard/positions");
    return { ok: true, applied: updated.length };
  } catch (err) {
    return dbResult(err);
  }
}

// Bulk position unregistration. Rows are soft-deleted; there is no bound
// guard yet (the worker table does not exist), so blocked is always 0 —
// the shape stays identical to the other bulk actions for the toolbar.
export async function deleteBulk(ids: string[]): Promise<ActionState> {
  const actor = await requireUser();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No positions selected." };
  }

  try {
    const deleted = await db
      .update(position)
      .set({ deletedAt: new Date() })
      .where(positionBulkMutationWhere(actor, validIds));
    const result: ActionState = {
      ok: true,
      applied: deleted.rowCount ?? 0,
      blocked: 0,
    };
    revalidatePath("/dashboard/positions");
    return result;
  } catch (err) {
    return dbResult(err);
  }
}
