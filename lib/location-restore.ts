import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { site, siteLocation } from "../drizzle/schema";
import { DUPLICATE_MESSAGES } from "../types/db-error";
import type { Tx } from "../types/db-tx";
import type { RowResult } from "../types/deleted";
import type { ScopeActor } from "../types/session";

const NOT_FOUND = "Deleted location not found.";

// Brings a soft-deleted location back: only the location row, which keeps its
// is_active (deleting one does not touch it). Its soft-deleted users, work
// areas, workers and shifts were deleted on their own and stay deleted.
//
// A superadmin reaches every site; an HO only their own, and a row outside
// that answers the plain not-found message, never one that proves it exists.
// A deleted site refuses the restore (a live location under a deleted site
// would be unreachable), and so does a live location of the same site that
// now holds the name. The live-name unique index is the backstop; the
// pre-check only turns the common clash into a plain message instead of an
// aborted transaction.
//
// Exported for tests, mirroring restoreSiteGuarded.
export async function restoreLocationGuarded(
  tx: Tx,
  actor: ScopeActor,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ siteId: siteLocation.siteId, name: siteLocation.name })
    .from(siteLocation)
    .where(and(eq(siteLocation.id, id), isNotNull(siteLocation.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };
  if (actor.role !== "superadmin" && row.siteId !== actor.siteId) {
    return { ok: false, message: NOT_FOUND };
  }

  const [deletedSite] = await tx
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, row.siteId), isNotNull(site.deletedAt)))
    .limit(1);
  if (deletedSite) {
    return { ok: false, message: "Site is deleted; restore it first" };
  }

  const [taken] = await tx
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(
      and(
        eq(siteLocation.siteId, row.siteId),
        eq(siteLocation.name, row.name),
        isNull(siteLocation.deletedAt),
      ),
    )
    .limit(1);
  if (taken) {
    return { ok: false, message: DUPLICATE_MESSAGES["location-name"] };
  }

  await tx
    .update(siteLocation)
    .set({ deletedAt: null })
    .where(eq(siteLocation.id, id));
  return { ok: true };
}
