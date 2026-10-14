export type Role = "superadmin" | "ho" | "admin";

export type Scope =
  | { kind: "all" }
  | { kind: "site"; siteId: string }
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
      return { kind: "site", siteId: u.siteId as string };
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
