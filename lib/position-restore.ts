import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { position, site, siteLocation } from "../drizzle/schema";
import { DUPLICATE_MESSAGES } from "../types/db-error";
import type { Tx } from "../types/db-tx";
import type { RowResult } from "../types/deleted";
import type { ScopeActor } from "../types/session";

const NOT_FOUND = "Deleted position not found.";

// Brings a soft-deleted position back: only the position row, which keeps its
// is_active. Positions are scoped by site alone (there is no location column):
// a superadmin reaches every site, an HO their own, and an admin the site of
// their location binding. A row outside that scope answers the plain
// not-found message, never one that proves it exists.
//
// A deleted site refuses the restore (a live position under a deleted site
// would be unreachable), and so does a live position of the same site that
// now holds the name. The live-name unique index is the backstop; the
// pre-check only turns the common clash into a plain message instead of an
// aborted transaction.
//
// Exported for tests, mirroring restoreSiteGuarded.
export async function restorePositionGuarded(
  tx: Tx,
  actor: ScopeActor,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ siteId: position.siteId, name: position.name })
    .from(position)
    .where(and(eq(position.id, id), isNotNull(position.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  if (actor.role !== "superadmin") {
    const actorSiteId =
      actor.role === "admin"
        ? await bindingSiteId(tx, actor.siteLocationId)
        : actor.siteId;
    if (!actorSiteId || row.siteId !== actorSiteId) {
      return { ok: false, message: NOT_FOUND };
    }
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
    .select({ id: position.id })
    .from(position)
    .where(
      and(
        eq(position.siteId, row.siteId),
        eq(position.name, row.name),
        isNull(position.deletedAt),
      ),
    )
    .limit(1);
  if (taken) {
    return { ok: false, message: DUPLICATE_MESSAGES["position-name"] };
  }

  await tx.update(position).set({ deletedAt: null }).where(eq(position.id, id));
  return { ok: true };
}

// The site of an admin's location binding; null for an unbound admin or a
// missing location, so the caller fails closed.
async function bindingSiteId(
  tx: Tx,
  siteLocationId: string | null,
): Promise<string | null> {
  if (!siteLocationId) return null;
  const [binding] = await tx
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(eq(siteLocation.id, siteLocationId))
    .limit(1);
  return binding?.siteId ?? null;
}
