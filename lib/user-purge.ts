import { and, eq, getTableName, isNotNull, or } from "drizzle-orm";

import {
  account,
  auditLog,
  mpRequest,
  mpRequestLine,
  rosterAssignment,
  rosterPlan,
  session,
  user,
} from "../drizzle/schema";
import type { Tx } from "../types/db-tx";
import type { PurgeCoverage, RowResult } from "../types/deleted";

const NOT_FOUND = "Deleted user not found.";

// Every table the purge deletes from, refuses on, or loses through ON DELETE
// CASCADE. lib/user-purge-coverage.test.ts compares these lists with the real
// foreign keys, so a table added later that points at user cannot be
// forgotten silently (the RESTRICT backstop would only fail the purge with a
// generic message). Names come from the drizzle tables, never from literals.
export const PURGE_COVERAGE: PurgeCoverage = {
  // Deleted by purgeUserGuarded below.
  purged: [user].map(getTableName),
  // Any row at all refuses the purge.
  history: [auditLog, rosterPlan, mpRequest].map(getTableName),
  // Removed by ON DELETE CASCADE: sessions and accounts from the user row,
  // assignments and request lines from the history rows above (which refuse
  // the purge, so the cascade never actually fires for a user).
  cascade: [session, account, rosterAssignment, mpRequestLine].map(
    getTableName,
  ),
};

// Permanent delete of an already soft-deleted user (superadmin only, the
// caller enforces it, so there is no per-actor scope here). Guards read first
// and the delete runs last, all in the caller's transaction, so a refusal
// leaves nothing partial. A user who authored an audit row, generated or
// published a roster plan, or created a request is part of that history and
// always refuses; the trail is never deleted. Sessions and credential
// accounts go with the user through their ON DELETE CASCADE foreign keys. FK
// RESTRICT stays the backstop (the action maps it through mapDbError).
//
// Exported for tests, mirroring purgeSiteGuarded.
export async function purgeUserGuarded(
  tx: Tx,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, id), isNotNull(user.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  const [audit] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.actorId, id))
    .limit(1);
  if (audit) {
    return {
      ok: false,
      message: "User has audit history and cannot be permanently deleted",
    };
  }

  const [plan] = await tx
    .select({ id: rosterPlan.id })
    .from(rosterPlan)
    .where(or(eq(rosterPlan.generatedBy, id), eq(rosterPlan.publishedBy, id)))
    .limit(1);
  if (plan) {
    return {
      ok: false,
      message: "User has roster history and cannot be permanently deleted",
    };
  }

  const [request] = await tx
    .select({ id: mpRequest.id })
    .from(mpRequest)
    .where(eq(mpRequest.createdBy, id))
    .limit(1);
  if (request) {
    return {
      ok: false,
      message: "User has request history and cannot be permanently deleted",
    };
  }

  await tx.delete(user).where(eq(user.id, id));
  return { ok: true };
}
