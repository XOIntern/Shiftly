import {
  and,
  eq,
  getTableName,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";

import {
  account,
  auditLog,
  mpRequest,
  mpRequestLine,
  rosterAssignment,
  rosterPlan,
  rosterRuleConfig,
  session,
  shiftDefinition,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
  worker,
  workerPosition,
} from "../drizzle/schema";
import type { Tx } from "../types/db-tx";
import type { PurgeCoverage, RowResult } from "../types/deleted";

const NOT_FOUND = "Deleted location not found.";

// Every table the purge deletes from, refuses on, or loses through ON DELETE
// CASCADE. lib/location-purge-coverage.test.ts compares these lists with the
// real foreign keys, so a table added later that points at one of them cannot
// be forgotten silently (the RESTRICT backstop would only fail the purge with
// a generic message). Names come from the drizzle tables, never from literals.
export const PURGE_COVERAGE: PurgeCoverage = {
  // Deleted by purgeLocationGuarded below.
  purged: [
    workerPosition,
    workAreaPosition,
    worker,
    workArea,
    shiftDefinition,
    rosterRuleConfig,
    user,
    siteLocation,
  ].map(getTableName),
  // Any row at all refuses the purge.
  history: [rosterPlan, mpRequest, auditLog].map(getTableName),
  // Removed by ON DELETE CASCADE from a table above.
  cascade: [rosterAssignment, mpRequestLine, session, account].map(
    getTableName,
  ),
};

// Permanent delete of an already soft-deleted location. Guards read first and
// the deletes run last, all in the caller's transaction, so a refusal leaves
// nothing partial. Live children refuse (deleting a location only checks its
// users, so a live work area, worker or shift can still sit under it);
// history (roster, request, audit) always refuses. The location's own rows are
// removed with it, children first because every FK into site_location is ON
// DELETE RESTRICT. FK RESTRICT stays the backstop (the action maps it through
// mapDbError).
//
// Superadmin only: the caller enforces it, so there is no per-actor scope here.
//
// Exported for tests, mirroring purgeSiteGuarded.
export async function purgeLocationGuarded(
  tx: Tx,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(and(eq(siteLocation.id, id), isNotNull(siteLocation.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  const locationUserIds = tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.siteLocationId, id));
  const locationWorkerIds = tx
    .select({ id: worker.id })
    .from(worker)
    .where(eq(worker.siteLocationId, id));

  // (1) Live children.
  const [liveArea] = await tx
    .select({ id: workArea.id })
    .from(workArea)
    .where(and(eq(workArea.siteLocationId, id), isNull(workArea.deletedAt)))
    .limit(1);
  if (liveArea) {
    return { ok: false, message: "Work areas still exist under this location" };
  }
  const [liveWorker] = await tx
    .select({ id: worker.id })
    .from(worker)
    .where(and(eq(worker.siteLocationId, id), isNull(worker.deletedAt)))
    .limit(1);
  if (liveWorker) {
    return { ok: false, message: "Workers still exist under this location" };
  }
  const [liveShift] = await tx
    .select({ id: shiftDefinition.id })
    .from(shiftDefinition)
    .where(
      and(
        eq(shiftDefinition.siteLocationId, id),
        isNull(shiftDefinition.deletedAt),
      ),
    )
    .limit(1);
  if (liveShift) {
    return { ok: false, message: "Shifts still exist under this location" };
  }
  const [liveUser] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.siteLocationId, id), isNull(user.deletedAt)))
    .limit(1);
  if (liveUser) {
    return { ok: false, message: "Users are still bound to this location" };
  }

  // (2) History: any row at all, deleted or not. A plan or request written by
  // one of the location's users counts even when it sits at another location,
  // and so does an assignment of one of its workers in a plan elsewhere.
  const [plan] = await tx
    .select({ id: rosterPlan.id })
    .from(rosterPlan)
    .where(
      or(
        eq(rosterPlan.siteLocationId, id),
        inArray(rosterPlan.generatedBy, locationUserIds),
        inArray(rosterPlan.publishedBy, locationUserIds),
      ),
    )
    .limit(1);
  const [assignment] = plan
    ? []
    : await tx
        .select({ id: rosterAssignment.id })
        .from(rosterAssignment)
        .where(inArray(rosterAssignment.workerId, locationWorkerIds))
        .limit(1);
  if (plan || assignment) {
    return {
      ok: false,
      message: "Location has roster history and cannot be permanently deleted",
    };
  }
  const [request] = await tx
    .select({ id: mpRequest.id })
    .from(mpRequest)
    .where(
      or(
        eq(mpRequest.siteLocationId, id),
        inArray(mpRequest.createdBy, locationUserIds),
      ),
    )
    .limit(1);
  if (request) {
    return {
      ok: false,
      message: "Location has request history and cannot be permanently deleted",
    };
  }
  const [audit] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      or(
        eq(auditLog.siteLocationId, id),
        inArray(auditLog.actorId, locationUserIds),
      ),
    )
    .limit(1);
  if (audit) {
    return {
      ok: false,
      message: "Location has audit history and cannot be permanently deleted",
    };
  }

  // (3) Purge, children first. The location's users are materialised before
  // any delete; the subqueries read tables that are removed below.
  const userIds = (await locationUserIds).map((u) => u.id);
  await tx
    .delete(workerPosition)
    .where(inArray(workerPosition.workerId, locationWorkerIds));
  await tx
    .delete(workAreaPosition)
    .where(eq(workAreaPosition.siteLocationId, id));
  await tx.delete(worker).where(eq(worker.siteLocationId, id));
  await tx.delete(workArea).where(eq(workArea.siteLocationId, id));
  await tx
    .delete(shiftDefinition)
    .where(eq(shiftDefinition.siteLocationId, id));
  await tx
    .delete(rosterRuleConfig)
    .where(eq(rosterRuleConfig.siteLocationId, id));
  if (userIds.length > 0) {
    await tx.delete(user).where(inArray(user.id, userIds));
  }
  await tx.delete(siteLocation).where(eq(siteLocation.id, id));
  return { ok: true };
}
