import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { pgErrorCode } from "../error/db-errors";
import { shiftDefinition, siteLocation } from "../drizzle/schema";
import type { Tx } from "../types/db-tx";
import type { RowResult } from "../types/deleted";
import type { ScopeActor } from "../types/session";
import { GENERIC_ERROR } from "./action-state";

const NOT_FOUND = "Deleted shift not found.";

// The partial unique on shift_definition (site_location_id, order_index) WHERE
// deleted_at IS NULL: the guard below reports the clash with this text, and
// the unique-index error (a race between the check and the write) maps to the
// same one. Same wording as the create/update field error.
const ORDER_TAKEN = "Order is already used by another shift";

// Brings a soft-deleted shift back: only the shift row, which keeps its
// is_active. A superadmin reaches every site, an HO their own, and an admin
// their own location; a row outside that scope answers the plain not-found
// message, never one that proves it exists.
//
// A deleted location refuses the restore (a live shift under a deleted
// location would be unreachable), and so does a live shift of the same
// location that now uses the order index. The unique index is the backstop;
// the pre-check only turns the common clash into a plain message instead of
// an aborted transaction.
//
// Exported for tests, mirroring restoreSiteGuarded.
export async function restoreShiftGuarded(
  tx: Tx,
  actor: ScopeActor,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({
      siteId: shiftDefinition.siteId,
      siteLocationId: shiftDefinition.siteLocationId,
      orderIndex: shiftDefinition.orderIndex,
    })
    .from(shiftDefinition)
    .where(and(eq(shiftDefinition.id, id), isNotNull(shiftDefinition.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  const inScope =
    actor.role === "superadmin" ||
    (actor.role === "admin"
      ? row.siteLocationId === actor.siteLocationId
      : row.siteId === actor.siteId);
  if (!inScope) return { ok: false, message: NOT_FOUND };

  const [deletedLocation] = await tx
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(
      and(
        eq(siteLocation.id, row.siteLocationId),
        isNotNull(siteLocation.deletedAt),
      ),
    )
    .limit(1);
  if (deletedLocation) {
    return { ok: false, message: "Location is deleted; restore it first" };
  }

  const [taken] = await tx
    .select({ id: shiftDefinition.id })
    .from(shiftDefinition)
    .where(
      and(
        eq(shiftDefinition.siteLocationId, row.siteLocationId),
        eq(shiftDefinition.orderIndex, row.orderIndex),
        isNull(shiftDefinition.deletedAt),
      ),
    )
    .limit(1);
  if (taken) return { ok: false, message: ORDER_TAKEN };

  await tx
    .update(shiftDefinition)
    .set({ deletedAt: null })
    .where(eq(shiftDefinition.id, id));
  return { ok: true };
}

// The message for a driver error thrown while restoring: the order-slot
// duplicate reads like the guard's refusal, a reference violation means the
// location vanished in between, anything else is generic.
export function restoreShiftError(err: unknown): string {
  const code = pgErrorCode(err);
  if (code === "23505") return ORDER_TAKEN;
  if (code === "23503" || code === "23001") {
    return "Selected location no longer exists";
  }
  return GENERIC_ERROR;
}
