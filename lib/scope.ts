import { type SQL, eq, inArray, or, sql } from "drizzle-orm";

import { siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";

// The enum stays the single source of truth for what a role string can be:
// lib/validators.ts and every call site gate role inputs against this list.
export const ROLES = ["superadmin", "ho", "admin"] as const;

export type Role = (typeof ROLES)[number];

export type Scope =
  | { kind: "all" }
  // A ho with no site binding scopes the empty set, not some site.
  | { kind: "site"; siteId: string | null }
  | { kind: "location"; siteLocationId: string | null };

// The role alone decides the Scope shape; the role's own binding fills it
// in (docs/architecture.md v0.2 §6): superadmin is global, ho is scoped to
// its site, admin to its site_location.
export function scopeOf(u: {
  role: Role;
  siteId: string | null;
  siteLocationId: string | null;
}): Scope {
  switch (u.role) {
    case "superadmin":
      return { kind: "all" };
    case "ho":
      return { kind: "site", siteId: u.siteId };
    case "admin":
      // An admin with no site_location binds the empty set, not "all".
      return { kind: "location", siteLocationId: u.siteLocationId };
  }
}

// Management rights over accounts: superadmin manages everyone; an ho
// manages only admins in its own site; an admin manages nobody.
export function canManageUser(
  actor: { role: Role; siteId: string | null },
  target: { role: Role; targetSiteId: string | null },
): boolean {
  if (actor.role === "superadmin") return true;
  if (
    actor.role === "ho" &&
    target.role === "admin" &&
    target.targetSiteId === actor.siteId
  ) {
    return true;
  }
  return false;
}

// Shared gate for acting on a target row already resolved through the
// site_location join (users list/edits): an admin whose bound location does
// not resolve to a real site carries no manageable target — only a
// superadmin may touch it, and an equally malformed ho actor must not pass
// via canManageUser's null === null match. Everyone else goes through
// canManageUser with the same resolved site the call sites computed before.
export function canManageActorTarget(
  actor: { role: Role; siteId: string | null },
  targetRow: { role: Role; locationSiteId: string | null },
): boolean {
  const targetSiteId =
    targetRow.role === "admin" ? (targetRow.locationSiteId ?? null) : null;
  if (targetRow.role === "admin" && targetSiteId === null) {
    return actor.role === "superadmin";
  }
  return canManageUser(actor, { role: targetRow.role, targetSiteId });
}

// Listing filter for the /users table (issue #18): a superadmin gets no
// WHERE (undefined = unfiltered); an ho sees only users bound to its own
// site — site-bound rows plus admins of the site's locations — and never
// superadmin or foreign-site rows. A null-bound ho matches nothing.
export function userScopeFilter(actor: {
  role: Role;
  siteId: string | null,
}): SQL | undefined {
  if (actor.role === "superadmin") return undefined;
  if (actor.siteId === null) return sql`false`;
  const siteLocations = db
    .select({ id: siteLocation.id })
    .from(siteLocation)
    .where(eq(siteLocation.siteId, actor.siteId));
  return or(
    eq(user.siteId, actor.siteId),
    inArray(user.siteLocationId, siteLocations),
  );
}
