import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { department, workArea } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer. siteLocationId lets the admin role
// scope its own work areas; an ho (or superadmin) carries null there.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// Data-level scoping for by-id department mutations (departments & work
// areas epic, GitHub #60): an ho may only touch departments under their
// own binding's site, so a direct call against another site's row must
// fail closed. superadmin is unbound and keeps full capability — owning
// nothing, owning everything. An admin carries no site binding
// (department.siteId is NOT NULL), so the siteId comparison denies them
// naturally. Reads the row's site rather than adding siteId to the
// mutating WHERE, so callers can reject with "not found" before any
// writes happen (mirrors locationOwnedByActor).
export async function departmentOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({ siteId: department.siteId })
    .from(department)
    .where(and(eq(department.id, id), isNull(department.deletedAt)))
    .limit(1);

  return !!row && row.siteId === actor.siteId;
}

// The weld (mirrors locationMutationWhere, issue #17 Task 2): the WHERE a
// by-id department mutation uses carries the ownership predicate inside
// the statement itself, closing the check-then-write (TOCTOU) window. For
// an ho that means `id = ? AND site_id = actor.siteId`; superadmin keeps
// the plain `id = ?`; an unbound actor gets `WHERE false` — fail closed.
// deleted_at IS NULL is pinned everywhere: a soft-deleted department is
// simply not there.
export function departmentMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return and(eq(department.id, id), isNull(department.deletedAt));
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(department.id, id),
    eq(department.siteId, actor.siteId),
    isNull(department.deletedAt),
  );
}

// The bulk form of departmentMutationWhere over an id list: an unbound
// actor keeps the `WHERE false` fail-closed shape; superadmin gets the
// plain id filter — both pinning deleted_at IS NULL.
export function departmentBulkMutationWhere(actor: ScopedActor, ids: string[]) {
  if (actor.role === "superadmin") {
    return and(inArray(department.id, ids), isNull(department.deletedAt));
  }
  if (!actor.siteId) return sql`false`;
  return and(
    inArray(department.id, ids),
    eq(department.siteId, actor.siteId),
    isNull(department.deletedAt),
  );
}

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
