import { and, eq, getTableName, isNotNull } from "drizzle-orm";

import { rosterAssignment, worker, workerPosition } from "../drizzle/schema";
import type { Tx } from "../types/db-tx";
import type { PurgeCoverage, RowResult } from "../types/deleted";

const NOT_FOUND = "Deleted worker not found.";

// Every table the purge deletes from or refuses on. Nothing cascades.
// lib/worker-purge-coverage.test.ts compares these lists with the real
// foreign keys, so a table added later that points at worker cannot be
// forgotten silently (the RESTRICT backstop would only fail the purge with a
// generic message). Names come from the drizzle tables, never from literals.
export const PURGE_COVERAGE: PurgeCoverage = {
  // Deleted by purgeWorkerGuarded below.
  purged: [workerPosition, worker].map(getTableName),
  // Any row at all refuses the purge.
  history: [rosterAssignment].map(getTableName),
  cascade: [],
};

// Permanent delete of an already soft-deleted worker (superadmin only, the
// caller enforces it). Guards read first and the deletes run last, all in the
// caller's transaction, so a refusal leaves nothing partial. A roster
// assignment is history and always refuses, and leaves the worker's position
// links in place. The worker's own links are removed with it, first because
// their FK is ON DELETE RESTRICT; the positions themselves belong to the site
// and stay. FK RESTRICT stays the backstop (the action maps it through
// mapDbError).
//
// Exported for tests, mirroring purgeSiteGuarded.
export async function purgeWorkerGuarded(
  tx: Tx,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ id: worker.id })
    .from(worker)
    .where(and(eq(worker.id, id), isNotNull(worker.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  const [assignment] = await tx
    .select({ id: rosterAssignment.id })
    .from(rosterAssignment)
    .where(eq(rosterAssignment.workerId, id))
    .limit(1);
  if (assignment) {
    return {
      ok: false,
      message: "Worker has roster history and cannot be permanently deleted",
    };
  }

  await tx.delete(workerPosition).where(eq(workerPosition.workerId, id));
  await tx.delete(worker).where(eq(worker.id, id));
  return { ok: true };
}
