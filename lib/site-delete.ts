import { and, eq, isNull } from "drizzle-orm";

import {
  department,
  site,
  siteLocation,
  user,
} from "../drizzle/schema";
import { db } from "./db";

// Transaction type produced by drizzle's db.transaction callback, so both
// the live db and a real tx can drive this helper.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DeleteSiteGuardResult =
  | { ok: true }
  | { ok: false; message: string };

// deleteSite's guarded core (issue #17 Task 2): the four relation guards
// and the write share the caller's transaction, so a site can never lose
// rows while a guard races a write — guards returning early roll nothing
// back (they only ever ran reads). Guard order and message strings are
// pinned by issue #17; the FK backstop stay as the action's catch outside.
// Since the soft-delete epic (#39), guards match only live rows and the
// final write soft-deletes (deletedAt), never a hard DELETE. Since #46,
// guard (0) demands an inactive site: deactivation is the explicit first
// step of winding a site down, and an unknown or already-deleted id is
// "Site not found." instead of a silent no-op.
//
// Exported for tests (lib/location-fk.test.ts drives it inside a real
// transaction), mirroring how locationOwnedByActor serves as the actions'
// test seam.
export async function deleteSiteGuarded(
  tx: Tx,
  id: string,
): Promise<DeleteSiteGuardResult> {
  // (0) The site exists, is live, and is inactive — deactivation comes
  // before any delete.
  const [row] = await tx
    .select({ isActive: site.isActive })
    .from(site)
    .where(and(eq(site.id, id), isNull(site.deletedAt)))
    .limit(1);
  if (!row) {
    return { ok: false, message: "Site not found." };
  }
  if (row.isActive) {
    return { ok: false, message: "Deactivate the site before deleting it" };
  }

  // (a) Live locations under the site.
  const [location] = await tx
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(and(eq(siteLocation.siteId, id), isNull(siteLocation.deletedAt)))
    .limit(1);
  if (location) {
    return { ok: false, message: "Locations still exist under this site" };
  }

  // (a2) Live departments under the site (issue #67). Work areas hang off
  // departments through the composite FK that pins the same site, so this
  // one check covers both subtrees; only the topmost layer is named.
  const [dept] = await tx
    .select({ id: department.id })
    .from(department)
    .where(and(eq(department.siteId, id), isNull(department.deletedAt)))
    .limit(1);
  if (dept) {
    return { ok: false, message: "Departments still exist under this site" };
  }

  // (b) Live users bound directly to the site.
  const [bound] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.siteId, id), isNull(user.deletedAt)))
    .limit(1);
  if (bound) {
    return { ok: false, message: "Users are still bound to this site" };
  }

  // (c) Live users bound to any live location under the site: a single join,
  // since the FK guard alone would only report the first offending row.
  const [boundLocation] = await tx
    .select({ id: user.id })
    .from(user)
    .innerJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    .where(
      and(
        eq(siteLocation.siteId, id),
        isNull(user.deletedAt),
        isNull(siteLocation.deletedAt),
      ),
    )
    .limit(1);
  if (boundLocation) {
    return { ok: false, message: "Users are still bound to this site" };
  }

  await tx
    .update(site)
    .set({ deletedAt: new Date() })
    .where(and(eq(site.id, id), isNull(site.deletedAt)));
  return { ok: true };
}
