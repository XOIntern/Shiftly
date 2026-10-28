import { and, eq, isNotNull, isNull } from "drizzle-orm";

import {
  position,
  siteLocation,
  worker,
  workerPosition,
} from "../drizzle/schema";
import { DUPLICATE_MESSAGES } from "../types/db-error";
import type { Tx } from "../types/db-tx";
import type { RowResult } from "../types/deleted";
import type { ScopeActor } from "../types/session";

const NOT_FOUND = "Deleted worker not found.";

// Brings a soft-deleted worker back: only the worker row, which keeps its
// is_active. Its position links never left, so a restored worker holds the
// same set as before.
//
// A superadmin reaches every site, an HO their own, and an admin their own
// location; a row outside that scope answers the plain not-found message,
// never one that proves it exists.
//
// Three things refuse the restore: a deleted location (a live worker under a
// deleted location would be unreachable), a held position that is itself
// soft-deleted (the worker would come back qualified for a position nobody
// can pick), and a live worker of the same location that now holds the
// employee id. The live-id unique index is the backstop; the pre-check only
// turns the common clash into a plain message instead of an aborted
// transaction.
//
// Exported for tests, mirroring restoreSiteGuarded.
export async function restoreWorkerGuarded(
  tx: Tx,
  actor: ScopeActor,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({
      siteId: worker.siteId,
      siteLocationId: worker.siteLocationId,
      employeeId: worker.employeeId,
    })
    .from(worker)
    .where(and(eq(worker.id, id), isNotNull(worker.deletedAt)))
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
    .from(workerPosition)
    .innerJoin(position, eq(position.id, workerPosition.positionId))
    .where(and(eq(workerPosition.workerId, id), isNotNull(position.deletedAt)))
    .limit(1);
  if (deletedPosition) {
    return {
      ok: false,
      message: "A position this worker holds is deleted; restore it first",
    };
  }

  const [taken] = await tx
    .select({ id: worker.id })
    .from(worker)
    .where(
      and(
        eq(worker.siteLocationId, row.siteLocationId),
        eq(worker.employeeId, row.employeeId),
        isNull(worker.deletedAt),
      ),
    )
    .limit(1);
  if (taken) {
    return { ok: false, message: DUPLICATE_MESSAGES["worker-employee-id"] };
  }

  await tx.update(worker).set({ deletedAt: null }).where(eq(worker.id, id));
  return { ok: true };
}
