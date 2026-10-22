import { and, eq, sql } from "drizzle-orm";

import { rosterPlan } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer. siteLocationId lets the admin role pin
// its own plans; an ho (or superadmin) carries null there.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// Roster-plan scoping (Cycle B): superadmin unbounded; an admin is pinned to
// their own site_location; an ho holds a READ grant over their own site's
// plans but never mutates them (spec decision 6 — HO is read-only on
// rosters), so every ho mutation predicate is a fail-closed `sql`false``:
// the page layer decides read access via the role, never via this WHERE.
export async function rosterPlanOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({
      siteId: rosterPlan.siteId,
      siteLocationId: rosterPlan.siteLocationId,
    })
    .from(rosterPlan)
    .where(eq(rosterPlan.id, id))
    .limit(1);

  if (!row) return false;
  return actor.role === "admin"
    ? row.siteLocationId === actor.siteLocationId
    : row.siteId === actor.siteId;
}

export function rosterPlanMutationWhere(actor: ScopedActor, id: string) {
  if (actor.role === "superadmin") {
    return eq(rosterPlan.id, id);
  }
  if (actor.role === "admin") {
    if (!actor.siteLocationId) return sql`false`;
    return and(
      eq(rosterPlan.id, id),
      eq(rosterPlan.siteLocationId, actor.siteLocationId),
    );
  }
  // Ho mutation is refused outright — the read grant is role-level, the
  // write refusal is this match-nothing predicate.
  return sql`false`;
}
