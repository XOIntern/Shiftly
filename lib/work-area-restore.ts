import { and, eq, isNotNull, isNull } from "drizzle-orm";

import {
  position,
  siteLocation,
  workArea,
  workAreaPosition,
} from "../drizzle/schema";
import { DUPLICATE_MESSAGES } from "../types/db-error";
import type { Tx } from "../types/db-tx";
import type { RowResult } from "../types/deleted";
import type { ScopeActor } from "../types/session";

const NOT_FOUND = "Deleted work area not found.";

// Brings a soft-deleted work area back: only the work area row, which keeps
// its is_active. Its position links never left, so a restored area requires
// the same set as before.
//
// A superadmin reaches every site, an HO their own, and an admin their own
// location; a row outside that scope answers the plain not-found message,
// never one that proves it exists.
//
// Three things refuse the restore: a deleted location (a live area under a
// deleted location would be unreachable), a required position that is itself
// soft-deleted (the area would come back requiring a position nobody can
// pick), and a live area of the same location that now holds the name. The
// live-name unique index is the backstop; the pre-check only turns the common
// clash into a plain message instead of an aborted transaction.
//
// Exported for tests, mirroring restoreSiteGuarded.
export async function restoreWorkAreaGuarded(
  tx: Tx,
  actor: ScopeActor,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({
      siteId: workArea.siteId,
      siteLocationId: workArea.siteLocationId,
      name: workArea.name,
    })
    .from(workArea)
    .where(and(eq(workArea.id, id), isNotNull(workArea.deletedAt)))
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

  const [deletedPosition] = await tx
    .select({ id: position.id })
    .from(workAreaPosition)
    .innerJoin(position, eq(position.id, workAreaPosition.positionId))
    .where(
      and(eq(workAreaPosition.workAreaId, id), isNotNull(position.deletedAt)),
    )
    .limit(1);
  if (deletedPosition) {
    return {
      ok: false,
      message: "A position this work area requires is deleted; restore it first",
    };
  }

  const [taken] = await tx
    .select({ id: workArea.id })
    .from(workArea)
    .where(
      and(
        eq(workArea.siteLocationId, row.siteLocationId),
        eq(workArea.name, row.name),
        isNull(workArea.deletedAt),
      ),
    )
    .limit(1);
  if (taken) {
    return { ok: false, message: DUPLICATE_MESSAGES["work-area-name"] };
  }

  await tx.update(workArea).set({ deletedAt: null }).where(eq(workArea.id, id));
  return { ok: true };
}
