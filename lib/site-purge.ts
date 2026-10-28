import {
  and,
  eq,
  getTableName,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";

import type { PurgeCoverage } from "@/types/deleted";

import {
  auditLog,
  account,
  mpRequest,
  mpRequestLine,
  position,
  rosterAssignment,
  rosterPlan,
  rosterRuleConfig,
  session,
  shiftDefinition,
  site,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
  worker,
  workerPosition,
} from "../drizzle/schema";
import { db } from "./db";

// Transaction type produced by drizzle's db.transaction callback, so both
// the live db and a real tx can drive this helper.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PurgeSiteResult = { ok: true } | { ok: false; message: string };

const NOT_FOUND = "Deleted site not found.";

// Every table the purge deletes from, refuses on, or loses through ON DELETE
// CASCADE. lib/site-purge-coverage.test.ts compares these lists with the real
// foreign keys, so a table added later that points at one of them cannot be
// forgotten silently (the RESTRICT backstop would only fail the purge with a
// generic message). Names come from the drizzle tables, never from literals.
export const PURGE_COVERAGE: PurgeCoverage = {
  // Deleted by purgeSiteGuarded below.
  purged: [
    workerPosition,
    workAreaPosition,
    worker,
    workArea,
    shiftDefinition,
    rosterRuleConfig,
    user,
    position,
    siteLocation,
    site,
  ].map(getTableName),
  // Any row at all refuses the purge.
  history: [rosterPlan, mpRequest, auditLog].map(getTableName),
  // Removed by ON DELETE CASCADE from a table above.
  cascade: [rosterAssignment, mpRequestLine, session, account].map(
    getTableName,
  ),
};

// Permanent delete of an already soft-deleted site. Guards read first and the
// deletes run last, all in the caller's transaction, so a refusal leaves
// nothing partial. History (roster, request, audit) always refuses; the
// site's master data is removed with it, children first because every FK to
// site/site_location is ON DELETE RESTRICT. FK RESTRICT stays the backstop
// (the action maps it through mapDbError).
//
// Exported for tests (lib/site-purge.test.ts drives it inside a real
// transaction), mirroring deleteSiteGuarded.
export async function purgeSiteGuarded(
  tx: Tx,
  id: string,
): Promise<PurgeSiteResult> {
  const [row] = await tx
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, id), isNotNull(site.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  const locationIds = tx
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(eq(siteLocation.siteId, id));
  const siteUserIds = tx
    .select({ id: user.id })
    .from(user)
    .where(or(eq(user.siteId, id), inArray(user.siteLocationId, locationIds)));

  // (1) Live structure: deleteSiteGuarded already guarantees none of this, so
  // these only fire on a race or a hand-edited row.
  const [liveLocation] = await tx
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(and(eq(siteLocation.siteId, id), isNull(siteLocation.deletedAt)))
    .limit(1);
  if (liveLocation) {
    return { ok: false, message: "Locations still exist under this site" };
  }
  const [liveArea] = await tx
    .select({ id: workArea.id })
    .from(workArea)
    .where(and(eq(workArea.siteId, id), isNull(workArea.deletedAt)))
    .limit(1);
  if (liveArea) {
    return { ok: false, message: "Work areas still exist under this site" };
  }
  const [liveUser] = await tx
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        isNull(user.deletedAt),
        or(eq(user.siteId, id), inArray(user.siteLocationId, locationIds)),
      ),
    )
    .limit(1);
  if (liveUser) {
    return { ok: false, message: "Users are still bound to this site" };
  }

  // (2) History: any row at all, deleted or not.
  const [plan] = await tx
    .select({ id: rosterPlan.id })
    .from(rosterPlan)
    .where(eq(rosterPlan.siteId, id))
    .limit(1);
  if (plan) {
    return {
      ok: false,
      message: "Site has roster history and cannot be permanently deleted",
    };
  }
  const [request] = await tx
    .select({ id: mpRequest.id })
    .from(mpRequest)
    .where(eq(mpRequest.siteId, id))
    .limit(1);
  if (request) {
    return {
      ok: false,
      message: "Site has request history and cannot be permanently deleted",
    };
  }
  const [audit] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      or(
        eq(auditLog.siteId, id),
        inArray(auditLog.siteLocationId, locationIds),
        inArray(auditLog.actorId, siteUserIds),
      ),
    )
    .limit(1);
  if (audit) {
    return {
      ok: false,
      message: "Site has audit history and cannot be permanently deleted",
    };
  }

  // (3) Purge, children first. The site's users are materialised before any
  // delete: the subquery reads site_location, which is removed below.
  const userIds = (await siteUserIds).map((u) => u.id);
  await tx.delete(workerPosition).where(eq(workerPosition.siteId, id));
  await tx.delete(workAreaPosition).where(eq(workAreaPosition.siteId, id));
  await tx.delete(worker).where(eq(worker.siteId, id));
  await tx.delete(workArea).where(eq(workArea.siteId, id));
  await tx.delete(shiftDefinition).where(eq(shiftDefinition.siteId, id));
  await tx
    .delete(rosterRuleConfig)
    .where(
      or(
        eq(rosterRuleConfig.siteId, id),
        inArray(rosterRuleConfig.siteLocationId, locationIds),
      ),
    );
  if (userIds.length > 0) {
    await tx.delete(user).where(inArray(user.id, userIds));
  }
  await tx.delete(position).where(eq(position.siteId, id));
  await tx.delete(siteLocation).where(eq(siteLocation.siteId, id));
  await tx.delete(site).where(eq(site.id, id));
  return { ok: true };
}
