import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { and, count, eq, isNull, sql } from "drizzle-orm";

import { position, siteLocation, workArea, worker } from "../drizzle/schema";
import { db } from "./db";

// Honest dashboard home (#122): per-role active master-data counts for the
// dashboard, mirroring the list pages' branch logic with the same
// fail-closed shape as lib/scope.ts — an actor with no binding on the
// dimension it needs counts nothing, never a cross-site number.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

export type DashboardCounts = {
  workers: number;
  positions: number;
  workAreas: number;
  locations: number;
};

// Every predicate adds deletedAt-is-null; isActive only where the column
// exists on the table — the four master-data tables here all carry both.
// superadmin is unscoped; ho filters on their site; admin on their
// location binding. Each unbound branch is sql`false` ⇒ zero rows.
function workerWhere(actor: ScopedActor) {
  if (actor.role === "superadmin") {
    return and(isNull(worker.deletedAt), eq(worker.isActive, true));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(worker.siteLocationId, actor.siteLocationId),
      isNull(worker.deletedAt),
      eq(worker.isActive, true),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(worker.siteId, actor.siteId),
    isNull(worker.deletedAt),
    eq(worker.isActive, true),
  );
}

// Positions are site-wide (no location column). For admin the site comes
// from the binding's scalar subquery, exactly like positionMutationWhere in
// lib/position-scope.ts — a dead (deleted/missing) binding resolves to
// NULL and never matches.
function positionWhere(actor: ScopedActor) {
  if (actor.role === "superadmin") {
    return and(isNull(position.deletedAt), eq(position.isActive, true));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(
        position.siteId,
        db
          .select({ siteId: siteLocation.siteId })
          .from(siteLocation)
          .where(eq(siteLocation.id, actor.siteLocationId)),
      ),
      isNull(position.deletedAt),
      eq(position.isActive, true),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(position.siteId, actor.siteId),
    isNull(position.deletedAt),
    eq(position.isActive, true),
  );
}

function workAreaWhere(actor: ScopedActor) {
  if (actor.role === "superadmin") {
    return and(isNull(workArea.deletedAt), eq(workArea.isActive, true));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(workArea.siteLocationId, actor.siteLocationId),
      isNull(workArea.deletedAt),
      eq(workArea.isActive, true),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(workArea.siteId, actor.siteId),
    isNull(workArea.deletedAt),
    eq(workArea.isActive, true),
  );
}

// Locations: ho counts their site's locations; admin counts their own
// single row (the one the binding points at), not a site-wide count.
function locationWhere(actor: ScopedActor) {
  if (actor.role === "superadmin") {
    return and(isNull(siteLocation.deletedAt), eq(siteLocation.isActive, true));
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(siteLocation.id, actor.siteLocationId),
      isNull(siteLocation.deletedAt),
      eq(siteLocation.isActive, true),
    );
  }
  if (!actor.siteId) return sql`false`;
  return and(
    eq(siteLocation.siteId, actor.siteId),
    isNull(siteLocation.deletedAt),
    eq(siteLocation.isActive, true),
  );
}

async function countRows(
  table: PgTable,
  where: SQL | undefined,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}

export async function dashboardCounts(actor: ScopedActor): Promise<DashboardCounts> {
  const [workers, positions, workAreas, locations] = await Promise.all([
    countRows(worker, workerWhere(actor)),
    countRows(position, positionWhere(actor)),
    countRows(workArea, workAreaWhere(actor)),
    countRows(siteLocation, locationWhere(actor)),
  ]);
  return { workers, positions, workAreas, locations };
}
