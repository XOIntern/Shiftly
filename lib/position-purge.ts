import { and, eq, getTableName, isNotNull } from "drizzle-orm";

import {
  mpRequestLine,
  position,
  workAreaPosition,
  workerPosition,
} from "../drizzle/schema";
import type { Tx } from "../types/db-tx";
import type { PurgeCoverage, RowResult } from "../types/deleted";

const NOT_FOUND = "Deleted position not found.";

// Every table the purge deletes from or refuses on. Nothing cascades: a
// position is a leaf of the master data, so the purge removes only its own
// row and refuses while any row still points at it.
// lib/position-purge-coverage.test.ts compares these lists with the real
// foreign keys, so a table added later that points at position cannot be
// forgotten silently (the RESTRICT backstop would only fail the purge with a
// generic message). Names come from the drizzle tables, never from literals.
export const PURGE_COVERAGE: PurgeCoverage = {
  // Deleted by purgePositionGuarded below.
  purged: [position].map(getTableName),
  // Any row at all refuses the purge, soft-deleted owners included.
  history: [workerPosition, workAreaPosition, mpRequestLine].map(getTableName),
  cascade: [],
};

// Permanent delete of an already soft-deleted position (superadmin only, the
// caller enforces it). Guards read first and the delete runs last, all in the
// caller's transaction, so a refusal leaves nothing partial. FK RESTRICT
// stays the backstop (the action maps it through mapDbError).
//
// The links of a SOFT-DELETED worker or work area refuse the purge too: those
// links are what a later restore of that worker or work area checks, so the
// owner has to be purged first. Only the position row is removed here — never
// a link row, which belongs to its owner.
//
// Exported for tests, mirroring purgeSiteGuarded.
export async function purgePositionGuarded(
  tx: Tx,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ id: position.id })
    .from(position)
    .where(and(eq(position.id, id), isNotNull(position.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  // Request history first: a line always implies a work-area link, so the
  // link guard below would otherwise hide the more telling reason.
  const [line] = await tx
    .select({ id: mpRequestLine.id })
    .from(mpRequestLine)
    .where(eq(mpRequestLine.positionId, id))
    .limit(1);
  if (line) {
    return {
      ok: false,
      message: "Position has request history and cannot be permanently deleted",
    };
  }

  const [workerLink] = await tx
    .select({ workerId: workerPosition.workerId })
    .from(workerPosition)
    .where(eq(workerPosition.positionId, id))
    .limit(1);
  if (workerLink) {
    return { ok: false, message: "Workers still reference this position" };
  }

  const [areaLink] = await tx
    .select({ workAreaId: workAreaPosition.workAreaId })
    .from(workAreaPosition)
    .where(eq(workAreaPosition.positionId, id))
    .limit(1);
  if (areaLink) {
    return { ok: false, message: "Position is still required by a work area" };
  }

  await tx.delete(position).where(eq(position.id, id));
  return { ok: true };
}
