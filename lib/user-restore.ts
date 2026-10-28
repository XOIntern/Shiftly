import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { site, siteLocation, user } from "../drizzle/schema";
import { DUPLICATE_MESSAGES } from "../types/db-error";
import type { Tx } from "../types/db-tx";
import type { RowResult } from "../types/deleted";
import type { ScopeActor } from "../types/session";
import { canManageActorTarget } from "./scope";

const NOT_FOUND = "Deleted user not found.";

// Brings a soft-deleted user back: only the user row, which keeps its
// is_active. Credentials were never touched by the delete and are not touched
// here, and no session is recreated: the user signs in again like anyone else.
//
// Access follows the users page: a superadmin reaches everyone, an HO only
// the admins of their own site's locations (canManageActorTarget, the same
// gate the other user actions use), and nobody else restores anything. A row
// outside that reach answers the plain not-found message, never one that
// proves it exists.
//
// Three things refuse the restore: an admin whose location is deleted (the
// admin would be bound to nothing reachable), an HO-role user whose site is
// deleted, and a live user that now holds the email. The live-email unique
// index is the backstop; the pre-check only turns the common clash into a
// plain message instead of an aborted transaction.
//
// Exported for tests, mirroring restoreSiteGuarded.
export async function restoreUserGuarded(
  tx: Tx,
  actor: ScopeActor,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({
      role: user.role,
      siteId: user.siteId,
      siteLocationId: user.siteLocationId,
      email: user.email,
    })
    .from(user)
    .where(and(eq(user.id, id), isNotNull(user.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  // The location is read without its deleted filter: an HO still reaches the
  // admin of a deleted location, and is told why the restore is refused.
  const [location] = row.siteLocationId
    ? await tx
        .select({ siteId: siteLocation.siteId, deletedAt: siteLocation.deletedAt })
        .from(siteLocation)
        .where(eq(siteLocation.id, row.siteLocationId))
        .limit(1)
    : [];

  // A restoring HO or superadmin only; an admin actor never gets here through
  // the page, but fails closed all the same.
  const reaches =
    actor.role !== "admin" &&
    canManageActorTarget(actor, {
      role: row.role,
      locationSiteId: location?.siteId ?? null,
    });
  if (!reaches) return { ok: false, message: NOT_FOUND };

  if (row.role === "admin" && location?.deletedAt) {
    return { ok: false, message: "Location is deleted; restore it first" };
  }

  if (row.role === "ho" && row.siteId) {
    const [deletedSite] = await tx
      .select({ id: site.id })
      .from(site)
      .where(and(eq(site.id, row.siteId), isNotNull(site.deletedAt)))
      .limit(1);
    if (deletedSite) {
      return { ok: false, message: "Site is deleted; restore it first" };
    }
  }

  const [taken] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.email, row.email), isNull(user.deletedAt)))
    .limit(1);
  if (taken) return { ok: false, message: DUPLICATE_MESSAGES.email };

  await tx.update(user).set({ deletedAt: null }).where(eq(user.id, id));
  return { ok: true };
}
