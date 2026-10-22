import { and, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { mpRequest } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer. siteLocationId lets the admin role pin
// its own requests; an ho (or superadmin) carries null there.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// MP-request scoping (Module 3): superadmin unbounded; an ho reaches every
// request under their own site; an admin is pinned to their own
// site_location. Both scope columns are NOT NULL on mp_request, so the
// welded comparisons fail closed on a null binding; there is no soft
// delete (rejection is the void path), so no deleted_at guard appears.
export async function mpRequestOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({ siteId: mpRequest.siteId, siteLocationId: mpRequest.siteLocationId })
    .from(mpRequest)
    .where(eq(mpRequest.id, id))
    .limit(1);

  if (!row) return false;
  return actor.role === "admin"
    ? row.siteLocationId === actor.siteLocationId
    : row.siteId === actor.siteId;
}

export function mpRequestMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return eq(mpRequest.id, id);
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(mpRequest.id, id),
      eq(mpRequest.siteLocationId, actor.siteLocationId),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(eq(mpRequest.id, id), eq(mpRequest.siteId, actor.siteId));
}

// Listing filter for the /dashboard/requests page: superadmin (undefined)
// is unbounded, an ho filters by their site, an admin by their own
// site_location. A null binding matches nothing rather than everything.
export function mpRequestListWhere(actor: ScopedActor): SQL | undefined {
  if (actor.role === "superadmin") return undefined;
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return eq(mpRequest.siteLocationId, actor.siteLocationId);
  }
  if (!actor.siteId) return sql`false`;
  return eq(mpRequest.siteId, actor.siteId);
}
