import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { worker } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer. siteLocationId lets the admin role
// scope its own workers; an ho (or superadmin) carries null there.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// Worker scoping: superadmin unscoped; an ho manages workers under their
// own site; an admin manages workers under their own site_location. Each
// fail closed on a null binding (both scope columns are NOT NULL, so the
// welded comparisons can never match).
export async function workerOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({ siteId: worker.siteId, siteLocationId: worker.siteLocationId })
    .from(worker)
    .where(and(eq(worker.id, id), isNull(worker.deletedAt)))
    .limit(1);

  if (!row) return false;
  return actor.role === "admin"
    ? row.siteLocationId === actor.siteLocationId
    : row.siteId === actor.siteId;
}

export function workerMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return and(eq(worker.id, id), isNull(worker.deletedAt));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(worker.id, id),
      eq(worker.siteLocationId, actor.siteLocationId),
      isNull(worker.deletedAt),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(worker.id, id),
    eq(worker.siteId, actor.siteId),
    isNull(worker.deletedAt),
  );
}

export function workerBulkMutationWhere(actor: ScopedActor, ids: string[]) {
  if (actor.role === "superadmin") {
    return and(inArray(worker.id, ids), isNull(worker.deletedAt));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      inArray(worker.id, ids),
      eq(worker.siteLocationId, actor.siteLocationId),
      isNull(worker.deletedAt),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    inArray(worker.id, ids),
    eq(worker.siteId, actor.siteId),
    isNull(worker.deletedAt),
  );
}
