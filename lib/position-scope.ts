import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { position, siteLocation } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer. siteLocationId lets the admin role
// reach its binding's site; an ho (or superadmin) carries null there.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// Position scoping is site-wide (position has no location column):
// superadmin unscoped; an ho manages positions under their own site; an
// admin manages positions under the site of their site_location binding —
// resolved through a scalar subquery, so a soft-deleted or missing binding
// yields null and can never match. Each role fails closed on a null
// binding (position.site_id is NOT NULL).
export async function positionOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  if (actor.role === "admin") {
    if (!actor.siteLocationId) return false;
    const [binding] = await db
      .select({ siteId: siteLocation.siteId })
      .from(siteLocation)
      .where(eq(siteLocation.id, actor.siteLocationId))
      .limit(1);
    if (!binding) return false;

    const [row] = await db
      .select({ siteId: position.siteId })
      .from(position)
      .where(and(eq(position.id, id), isNull(position.deletedAt)))
      .limit(1);
    return row ? row.siteId === binding.siteId : false;
  }

  const [row] = await db
    .select({ siteId: position.siteId })
    .from(position)
    .where(and(eq(position.id, id), isNull(position.deletedAt)))
    .limit(1);
  if (!row) return false;
  return row.siteId === actor.siteId;
}

export function positionMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return and(eq(position.id, id), isNull(position.deletedAt));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    // Scalar subquery: the binding's site_id. A dead (deleted/missing)
    // binding resolves to NULL, and NULL = site_id is never true — the
    // same fail-closed shape as the unbound branches.
    return and(
      eq(position.id, id),
      eq(
        position.siteId,
        db
          .select({ siteId: siteLocation.siteId })
          .from(siteLocation)
          .where(eq(siteLocation.id, actor.siteLocationId)),
      ),
      isNull(position.deletedAt),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(position.id, id),
    eq(position.siteId, actor.siteId),
    isNull(position.deletedAt),
  );
}

export function positionBulkMutationWhere(actor: ScopedActor, ids: string[]) {
  if (actor.role === "superadmin") {
    return and(inArray(position.id, ids), isNull(position.deletedAt));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      inArray(position.id, ids),
      eq(
        position.siteId,
        db
          .select({ siteId: siteLocation.siteId })
          .from(siteLocation)
          .where(eq(siteLocation.id, actor.siteLocationId)),
      ),
      isNull(position.deletedAt),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    inArray(position.id, ids),
    eq(position.siteId, actor.siteId),
    isNull(position.deletedAt),
  );
}
