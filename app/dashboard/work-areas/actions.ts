"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  position,
  siteLocation,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError, pgErrorConstraint, pgErrorCode } from "@/error/db-errors";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import {
  workAreaCreateSchema,
  workAreaUpdateSchema,
} from "@/validation/worker-area";
import {
  workAreaMutationWhere,
  workAreaOwnedByActor,
  workAreaBulkMutationWhere,
} from "@/lib/work-area-scope";

// Maps a driver error to the action result shape; mapDbError returns null for
// anything unexpected, so fall back to a generic message.
function dbResult(err: unknown): ActionState {
  const mapped = mapDbError(err, { kind: "work-area-name" });
  if (mapped) return { ok: false, message: mapped };
  return { ok: false, message: GENERIC_ERROR };
}

// The composite FK on work_area (site_location_id + site_id) carries ON
// DELETE restrict, so a pairing whose location row vanished between the
// site derivation and the write surfaces as 23503/23001. The site is
// always derived server-side from the location, so any other firing is a
// race — this is the net.
const FK_MESSAGE = "Selected location no longer exists";

function fkResult(err: unknown): ActionState {
  const code = pgErrorCode(err);
  if (code === "23503" || code === "23001") {
    return { ok: false, message: FK_MESSAGE };
  }
  return dbResult(err);
}

// Admin actors are pinned to their own site_location — anything the client
// sent is ignored. A superadmin keeps the input value; an ho has no
// location binding and keeps the input too, but their site scope below
// verifies it.
function effectiveSiteLocationId(
  actor: SessionUser,
  inputSiteLocationId: string | undefined,
): string | undefined {
  return actor.role === "admin"
    ? (actor.siteLocationId ?? undefined)
    : inputSiteLocationId;
}

// siteId is NEVER trusted from the client: it is derived from the work
// area's own site_location, so the composite FK pairing is decided
// server-side. A soft-deleted location cannot parent a work area (mirrors
// the dropped department derivation's live-row weld).
async function deriveSiteId(siteLocationId: string): Promise<string | null> {
  const [row] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(
      and(eq(siteLocation.id, siteLocationId), isNull(siteLocation.deletedAt)),
    )
    .limit(1);
  return row ? row.siteId : null;
}

// Scope check for the chosen location: an ho may only reference a location
// under their own site. A foreign location surfaces as a field error,
// mirroring the users actions' per-field shape for scope violations. An
// admin's pick is pinned to their own binding before this runs;
// superadmin is unscoped.
const LOCATION_SCOPE_FIELD_ERRORS = {
  siteLocationId: "Location must be in your site",
} as const;

function locationInScope(actor: SessionUser, locationSiteId: string | null) {
  return actor.role !== "ho" || locationSiteId === actor.siteId;
}

// Thrown inside updateWorkArea's transaction so the pivot delete that ran
// before the welded update is rolled back, not committed. A returned value
// would commit the transaction; a throw is the only rollback.
class WorkAreaNotFoundError extends Error {}

// Every position of the required set must be live and parent to the SAME
// site as the work area (mirrors the worker update's check): the client
// only picks by id — the weld is re-checked server-side. Inactive positions
// are tolerated: an edit that never touches the set must not fail because
// one was deactivated since the picker snapshot.
type RequiredPositionsCheck =
  | { ok: true }
  | { fieldError: "Position must be in the same site as the location" };

async function checkRequiredPositions(
  ids: readonly string[],
  siteId: string,
): Promise<RequiredPositionsCheck> {
  const rows = await db
    .select({ id: position.id, siteId: position.siteId })
    .from(position)
    .where(and(inArray(position.id, [...ids]), isNull(position.deletedAt)));
  const allLiveAndSameSite =
    rows.length === ids.length && rows.every((row) => row.siteId === siteId);
  return allLiveAndSameSite
    ? { ok: true }
    : { fieldError: "Position must be in the same site as the location" };
}

export async function createWorkArea(input: {
  siteId?: string;
  siteLocationId?: string;
  name: string;
  requiredPositionIds: readonly string[];
}): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = workAreaCreateSchema.safeParse({
    // Ignored — derived from the site_location below.
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    name: input.name,
    requiredPositionIds: input.requiredPositionIds,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // An unbound admin fails closed at the field, not at the DB (the
  // required siteLocationId rejects the undefined effective value).
  const derivedSiteId = await deriveSiteId(parsed.data.siteLocationId);
  if (!derivedSiteId) {
    return {
      ok: false,
      fieldErrors: { siteLocationId: "Location not found." },
    };
  }
  if (!locationInScope(actor, derivedSiteId)) {
    return { ok: false, fieldErrors: LOCATION_SCOPE_FIELD_ERRORS };
  }

  // The client only picks position ids: the weld to the area's site is
  // re-checked server-side before any write.
  const positionCheck = await checkRequiredPositions(
    parsed.data.requiredPositionIds,
    derivedSiteId,
  );
  if ("fieldError" in positionCheck) {
    return {
      ok: false,
      fieldErrors: { requiredPositionIds: positionCheck.fieldError },
    };
  }

  // The area and its required set commit or roll back together: no orphan
  // area without positions when the pivot insert fails.
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(workArea)
        .values({
          siteId: derivedSiteId,
          siteLocationId: parsed.data.siteLocationId,
          name: parsed.data.name,
        })
        .returning({ id: workArea.id });

      await tx.insert(workAreaPosition).values(
        parsed.data.requiredPositionIds.map((positionId) => ({
          workAreaId: created.id,
          positionId,
          siteId: derivedSiteId,
          siteLocationId: parsed.data.siteLocationId,
        })),
      );
    });
  } catch (err) {
    // The server-side check leaves only a race: a position removed between
    // the check and the insert surfaces on the field that carried it.
    if (pgErrorConstraint(err) === "work_area_position_position_site_fk") {
      return {
        ok: false,
        fieldErrors: {
          requiredPositionIds: "Selected position no longer exists",
        },
      };
    }
    return fkResult(err);
  }

  revalidatePath("/dashboard/work-areas");
  revalidatePath("/dashboard/roster");
  return { ok: true };
}

export async function updateWorkArea(
  id: string,
  input: {
    siteId?: string;
    siteLocationId?: string;
    name: string;
    isActive: boolean;
    requiredPositionIds?: readonly string[];
  },
): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = workAreaUpdateSchema.safeParse({
    id,
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    name: input.name,
    isActive: input.isActive,
    requiredPositionIds: input.requiredPositionIds,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Ownership before any write: the row must already sit in the actor's
  // scope, or a foreign work area would be rewritten.
  if (!(await workAreaOwnedByActor(actor, parsed.data.id))) {
    return { ok: false, message: "Work area not found." };
  }

  // undefined for an ho/superadmin edit without a siteLocationId: both the
  // location and its derived site keep their current values (they move
  // together, so the composite FK pairing stays consistent). An admin
  // always lands on their own location.
  let nextSiteId: string | undefined;
  if (parsed.data.siteLocationId) {
    const derivedSiteId = await deriveSiteId(parsed.data.siteLocationId);
    if (!derivedSiteId) {
      return {
        ok: false,
        fieldErrors: { siteLocationId: "Location not found." },
      };
    }
    if (!locationInScope(actor, derivedSiteId)) {
      return { ok: false, fieldErrors: LOCATION_SCOPE_FIELD_ERRORS };
    }
    nextSiteId = derivedSiteId;
  }

  // The set replacement welds every pivot row to the area's FINAL pairing
  // (site_location + site), which is the new pairing when the location
  // moves in this same write and the current one when it does not.
  const requiredPositionIds = parsed.data.requiredPositionIds;

  try {
    if (requiredPositionIds === undefined) {
      const updated = await db
        .update(workArea)
        .set({
          siteId: nextSiteId,
          siteLocationId: parsed.data.siteLocationId,
          name: parsed.data.name,
          isActive: parsed.data.isActive,
        })
        // Weld: the ownership predicate rides inside the mutating WHERE.
        .where(workAreaMutationWhere(actor, parsed.data.id))
        .returning({ id: workArea.id });
      if (updated.length === 0) {
        return { ok: false, message: "Work area not found." };
      }
    } else {
      // Freeze the final pairing for the transaction closure: mutable
      // let-narrowing does not survive into an async callback.
      let siteId = nextSiteId;
      let locationId = parsed.data.siteLocationId;
      if (!siteId || !locationId) {
        const [current] = await db
          .select({
            siteLocationId: workArea.siteLocationId,
            siteId: workArea.siteId,
          })
          .from(workArea)
          .where(eq(workArea.id, parsed.data.id))
          .limit(1);
        if (!current) {
          return { ok: false, message: "Work area not found." };
        }
        siteId = current.siteId;
        locationId = current.siteLocationId;
      }
      const pivotSiteId = siteId;
      const pivotLocationId = locationId;

      // Every position of the set must be live and parent to the same site
      // as the work area (worker update pattern): the client only picks by
      // id, so the weld is re-checked server-side before any write.
      const positionCheck = await checkRequiredPositions(
        requiredPositionIds,
        pivotSiteId,
      );
      if ("fieldError" in positionCheck) {
        return {
          ok: false,
          fieldErrors: { requiredPositionIds: positionCheck.fieldError },
        };
      }

      // The row update and the whole required-position set commit or roll
      // back together (worker update pattern): fixed order — pivot rows
      // delete first, then the welded update, then the new set is inserted
      // against the final pairing. Zero rows from the welded update must
      // ROLL BACK, not return: a returned value commits, which would
      // persist the delete above. The throw is the rollback.
      await db.transaction(async (tx) => {
        await tx
          .delete(workAreaPosition)
          .where(eq(workAreaPosition.workAreaId, parsed.data.id));

        const updated = await tx
          .update(workArea)
          .set({
            siteId: nextSiteId,
            siteLocationId: parsed.data.siteLocationId,
            name: parsed.data.name,
            isActive: parsed.data.isActive,
          })
          .where(workAreaMutationWhere(actor, parsed.data.id))
          .returning({ id: workArea.id });
        if (updated.length === 0) throw new WorkAreaNotFoundError();

        if (requiredPositionIds.length > 0) {
          await tx.insert(workAreaPosition).values(
            requiredPositionIds.map((positionId) => ({
              workAreaId: parsed.data.id,
              positionId,
              siteId: pivotSiteId,
              siteLocationId: pivotLocationId,
            })),
          );
        }
      });
    }
  } catch (err) {
    if (err instanceof WorkAreaNotFoundError) {
      return { ok: false, message: "Work area not found." };
    }
    // A 23503 fired while the set was in play belongs to the pivot's
    // position FK (the server-side check leaves only a race): the field
    // error rides on the set that carried it, not on a global message.
    if (
      requiredPositionIds !== undefined &&
      pgErrorConstraint(err) === "work_area_position_position_site_fk"
    ) {
      return {
        ok: false,
        fieldErrors: {
          requiredPositionIds: "Selected position no longer exists",
        },
      };
    }
    return fkResult(err);
  }

  revalidatePath("/dashboard/work-areas");
  revalidatePath("/dashboard/roster");
  return { ok: true };
}

export async function toggleWorkArea(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid work area id." };
  }

  try {
    const toggled = await db
      .update(workArea)
      .set({ isActive: sql`not ${workArea.isActive}` })
      .where(workAreaMutationWhere(actor, id))
      .returning({ isActive: workArea.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Work area not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/work-areas");
  return { ok: true };
}

export async function deleteWorkArea(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid work area id." };
  }

  // Foreign work areas answer "not found." — never anything scope-leaking.
  if (!(await workAreaOwnedByActor(actor, id))) {
    return { ok: false, message: "Work area not found." };
  }

  try {
    await db
      .update(workArea)
      .set({ deletedAt: new Date() })
      // Weld: same ownership-in-WHERE as update/toggle.
      .where(workAreaMutationWhere(actor, id));
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/work-areas");
  return { ok: true };
}

// Bulk subset-write of workArea.isActive. "Do what you can": malformed ids
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
    return { ok: false, message: "No work areas selected." };
  }

  try {
    const updated = await db
      .update(workArea)
      .set({ isActive })
      .where(workAreaBulkMutationWhere(actor, validIds))
      .returning({ id: workArea.id });
    revalidatePath("/dashboard/work-areas");
    return { ok: true, applied: updated.length };
  } catch (err) {
    return dbResult(err);
  }
}

// Bulk work-area unregistration. The write soft-deletes.
export async function deleteBulk(ids: string[]): Promise<ActionState> {
  const actor = await requireUser();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No work areas selected." };
  }

  try {
    const deleted = await db
      .update(workArea)
      .set({ deletedAt: new Date() })
      .where(workAreaBulkMutationWhere(actor, validIds));
    revalidatePath("/dashboard/work-areas");
    return { ok: true, applied: deleted.rowCount ?? 0 };
  } catch (err) {
    return dbResult(err);
  }
}
