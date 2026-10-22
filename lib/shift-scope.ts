import { and, eq, isNull, sql } from "drizzle-orm";

import { shiftDefinition } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer. siteLocationId lets the admin role
// scope its own shifts; an ho (or superadmin) carries null there.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// Shift-definition scoping: superadmin unscoped; an ho manages shifts under
// their own site; an admin manages shifts under their own site_location.
// Each fail closed on a null binding (both scope columns are NOT NULL, so
// the welded comparisons can never match), and every branch excludes
// soft-deleted shifts.
export async function shiftOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({
      siteId: shiftDefinition.siteId,
      siteLocationId: shiftDefinition.siteLocationId,
    })
    .from(shiftDefinition)
    .where(and(eq(shiftDefinition.id, id), isNull(shiftDefinition.deletedAt)))
    .limit(1);

  if (!row) return false;
  return actor.role === "admin"
    ? row.siteLocationId === actor.siteLocationId
    : row.siteId === actor.siteId;
}

export function shiftMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return and(eq(shiftDefinition.id, id), isNull(shiftDefinition.deletedAt));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(shiftDefinition.id, id),
      eq(shiftDefinition.siteLocationId, actor.siteLocationId),
      isNull(shiftDefinition.deletedAt),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(shiftDefinition.id, id),
    eq(shiftDefinition.siteId, actor.siteId),
    isNull(shiftDefinition.deletedAt),
  );
}
