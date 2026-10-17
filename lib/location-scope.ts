import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { siteLocation } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer.
type ScopedActor = { role: "superadmin" | "ho" | "admin"; siteId: string | null };

// Data-level scoping for by-id location mutations (docs/architecture.md
// §7.2): a ho may only touch locations under their own binding's site, so a
// direct call against another site's row must fail closed. superadmin is
// unbound and keeps full capability — owning nothing, owning everything.
//
// Reads the row's site rather than adding siteId to the mutating WHERE, so
// callers can reject with "Location not found." before any writes happen
// (mirrors users/actions.ts loadManagedTarget). An unbound ho (siteId null)
// can never match, since site_location.site_id is NOT NULL.
export async function locationOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(and(eq(siteLocation.id, id), isNull(siteLocation.deletedAt)))
    .limit(1);

  return !!row && row.siteId === actor.siteId;
}

// The weld (issue #17 Task 2): the WHERE a by-id mutation uses carries the
// ownership predicate inside the statement itself, so the check-then-write
// (TOCTOU) window closes even without the pre-check above. For an ho that
// means `id = ? AND site_id = actor.siteId`; superadmin keeps the plain
// `id = ?`. An unbound ho gets `WHERE false` — fail closed on a row it
// cannot scope to. Since the soft-delete epic, both scoping branches also
// pin deleted_at IS NULL: a deleted location is simply not there.
export function locationMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return and(eq(siteLocation.id, id), isNull(siteLocation.deletedAt));
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(siteLocation.id, id),
    eq(siteLocation.siteId, actor.siteId),
    isNull(siteLocation.deletedAt),
  );
}

// The bulk form of locationMutationWhere: the same ownership predicate
// welded into the statement, over an id list. An unbound ho keeps the
// `WHERE false` fail-closed shape; a superadmin gets the plain id filter —
// both pinning deleted_at IS NULL, so deleted rows never mutate again.
export function locationBulkMutationWhere(actor: ScopedActor, ids: string[]) {
  if (actor.role === "superadmin") {
    return and(inArray(siteLocation.id, ids), isNull(siteLocation.deletedAt));
  }
  if (!actor.siteId) return sql`false`;
  return and(
    inArray(siteLocation.id, ids),
    eq(siteLocation.siteId, actor.siteId),
    isNull(siteLocation.deletedAt),
  );
}
