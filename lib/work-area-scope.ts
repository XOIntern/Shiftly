import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { workArea } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer. siteLocationId lets the admin role
// scope its own work areas; an ho (or superadmin) carries null there.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// Work-area scoping: superadmin unscoped; an ho manages work areas under
// their own site; an admin manages work areas under their own
// site_location. Each fail closed on a null binding (both scope columns
// are NOT NULL, so the welded comparisons can never match).
export async function workAreaOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({ siteId: workArea.siteId, siteLocationId: workArea.siteLocationId })
    .from(workArea)
    .where(and(eq(workArea.id, id), isNull(workArea.deletedAt)))
    .limit(1);

  if (!row) return false;
  return actor.role === "admin"
    ? row.siteLocationId === actor.siteLocationId
    : row.siteId === actor.siteId;
}

export function workAreaMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return and(eq(workArea.id, id), isNull(workArea.deletedAt));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(workArea.id, id),
      eq(workArea.siteLocationId, actor.siteLocationId),
      isNull(workArea.deletedAt),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(workArea.id, id),
    eq(workArea.siteId, actor.siteId),
    isNull(workArea.deletedAt),
  );
}

export function workAreaBulkMutationWhere(actor: ScopedActor, ids: string[]) {
  if (actor.role === "superadmin") {
    return and(inArray(workArea.id, ids), isNull(workArea.deletedAt));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      inArray(workArea.id, ids),
      eq(workArea.siteLocationId, actor.siteLocationId),
      isNull(workArea.deletedAt),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    inArray(workArea.id, ids),
    eq(workArea.siteId, actor.siteId),
    isNull(workArea.deletedAt),
  );
}
