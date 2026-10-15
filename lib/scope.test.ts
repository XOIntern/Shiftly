import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { site, siteLocation, user } from "../drizzle/schema";
import {
  canManageActorTarget,
  canManageUser,
  scopeOf,
  userScopeFilter,
} from "./scope";
import type { Role, Scope } from "./scope";

const SITE_A = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
const SITE_B = "7d2c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b03";
const LOC_A = "8e3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
const LOC_B = "9f4c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b05";

describe("scopeOf", () => {
  // The role alone decides the Scope shape; the role's own binding fills
  // it in, and bindings belonging to other roles are ignored.
  const table: Array<{
    role: Role;
    siteId: string | null;
    siteLocationId: string | null;
    expected: Scope;
  }> = [
    {
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      expected: { kind: "all" },
    },
    {
      role: "superadmin",
      siteId: SITE_A,
      siteLocationId: LOC_A,
      expected: { kind: "all" },
    },
    {
      role: "ho",
      siteId: SITE_A,
      siteLocationId: null,
      expected: { kind: "site", siteId: SITE_A },
    },
    {
      role: "ho",
      siteId: SITE_B,
      siteLocationId: null,
      expected: { kind: "site", siteId: SITE_B },
    },
    {
      role: "admin",
      siteId: null,
      siteLocationId: LOC_A,
      expected: { kind: "location", siteLocationId: LOC_A },
    },
    {
      role: "admin",
      siteId: null,
      siteLocationId: LOC_B,
      expected: { kind: "location", siteLocationId: LOC_B },
    },
    // Issue #16: ho with no site binding = the empty-set convention
    // (siteId null), never "all" and never a cast lie.
    {
      role: "ho",
      siteId: null,
      siteLocationId: null,
      expected: { kind: "site", siteId: null },
    },
    // An admin with no site_location binds the empty set (not "all").
    {
      role: "admin",
      siteId: null,
      siteLocationId: null,
      expected: { kind: "location", siteLocationId: null },
    },
  ];

  test.each(table)(
    "$role",
    ({ role, siteId, siteLocationId, expected }) => {
      expect(scopeOf({ role, siteId, siteLocationId })).toEqual(expected);
    },
  );

  test("scopeOf never returns the all scope for ho or admin", () => {
    for (const [role, siteId, siteLocationId] of [
      ["ho", SITE_A, null],
      ["admin", null, LOC_A],
      ["admin", null, null],
    ] as const) {
      const scope = scopeOf({ role, siteId, siteLocationId });
      expect(scope.kind).not.toBe("all");
    }
  });
});

describe("canManageUser", () => {
  const table: Array<{
    name: string;
    actor: { role: Role; siteId: string | null };
    target: { role: Role; targetSiteId: string | null };
    expected: boolean;
  }> = [
    {
      name: "superadmin manages any target",
      actor: { role: "superadmin", siteId: null },
      target: { role: "admin", targetSiteId: SITE_A },
      expected: true,
    },
    {
      name: "superadmin manages another superadmin",
      actor: { role: "superadmin", siteId: null },
      target: { role: "superadmin", targetSiteId: null },
      expected: true,
    },
    {
      name: "ho manages an admin in its own site",
      actor: { role: "ho", siteId: SITE_A },
      target: { role: "admin", targetSiteId: SITE_A },
      expected: true,
    },
    {
      name: "ho cannot manage an admin in a foreign site",
      actor: { role: "ho", siteId: SITE_A },
      target: { role: "admin", targetSiteId: SITE_B },
      expected: false,
    },
    {
      name: "ho cannot manage another ho",
      actor: { role: "ho", siteId: SITE_A },
      target: { role: "ho", targetSiteId: SITE_A },
      expected: false,
    },
    {
      name: "ho cannot manage a superadmin",
      actor: { role: "ho", siteId: SITE_A },
      target: { role: "superadmin", targetSiteId: null },
      expected: false,
    },
    {
      name: "admin manages nobody (same site)",
      actor: { role: "admin", siteId: null },
      target: { role: "admin", targetSiteId: SITE_A },
      expected: false,
    },
    {
      name: "admin manages nobody (ho)",
      actor: { role: "admin", siteId: null },
      target: { role: "ho", targetSiteId: SITE_A },
      expected: false,
    },
    {
      name: "admin manages nobody (superadmin)",
      actor: { role: "admin", siteId: null },
      target: { role: "superadmin", targetSiteId: null },
      expected: false,
    },
  ];

  test.each(table)("$name", ({ actor, target, expected }) => {
    expect(canManageUser(actor, target)).toBe(expected);
  });
});

describe("canManageActorTarget", () => {
  // Consolidates the malformed-row rule duplicated in users/actions.ts
  // (canManage) and users/page.tsx (canManageRow): an admin row whose
  // location binding does not resolve to a real site is superadmin-only;
  // everything else delegates to canManageUser with the resolved site.
  const table: Array<{
    name: string;
    actor: { role: Role; siteId: string | null };
    targetRow: { role: Role; locationSiteId: string | null };
    expected: boolean;
  }> = [
    {
      name: "superadmin manages a malformed admin row (null binding)",
      actor: { role: "superadmin", siteId: null },
      targetRow: { role: "admin", locationSiteId: null },
      expected: true,
    },
    {
      name: "ho cannot manage a malformed admin row (null binding)",
      actor: { role: "ho", siteId: SITE_A },
      targetRow: { role: "admin", locationSiteId: null },
      expected: false,
    },
    {
      name: "ho manages an admin row in its own site",
      actor: { role: "ho", siteId: SITE_A },
      targetRow: { role: "admin", locationSiteId: SITE_A },
      expected: true,
    },
    {
      name: "ho cannot manage an admin row in a foreign site",
      actor: { role: "ho", siteId: SITE_A },
      targetRow: { role: "admin", locationSiteId: SITE_B },
      expected: false,
    },
    {
      name: "null-site ho manages nobody",
      actor: { role: "ho", siteId: null },
      targetRow: { role: "admin", locationSiteId: SITE_A },
      expected: false,
    },
    {
      name: "superadmin manages anything (ho row)",
      actor: { role: "superadmin", siteId: null },
      targetRow: { role: "ho", locationSiteId: SITE_A },
      expected: true,
    },
    {
      name: "ho cannot manage another ho (delegates to canManageUser)",
      actor: { role: "ho", siteId: SITE_A },
      targetRow: { role: "ho", locationSiteId: SITE_A },
      expected: false,
    },
    {
      name: "admin manages nobody",
      actor: { role: "admin", siteId: null },
      targetRow: { role: "admin", locationSiteId: SITE_A },
      expected: false,
    },
  ];

  test.each(table)("$name", ({ actor, targetRow, expected }) => {
    expect(canManageActorTarget(actor, targetRow)).toBe(expected);
  });
});

// Real-DB cases for userScopeFilter (issue #16): the ho filter must return
// exactly the users bound to the ho's own site — site-bound ho rows plus
// admins of the site's locations — and never foreign rows, never superadmin
// rows. The superadmin filter is undefined (unfiltered).
describe("userScopeFilter (real DB)", () => {
  test("ho filter returns exactly own-site rows", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const ownSiteHo = randomUUID();
    const foreignHo = randomUUID();
    const ownSiteLocAdmin = randomUUID();
    const foreignLocAdmin = randomUUID();
    const superadminRow = randomUUID();
    const malformedAdmin = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteA, name: `scope-filter-site-a-${siteA}` },
        { id: siteB, name: `scope-filter-site-b-${siteB}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "Scope Filter L1" },
        { id: locB, siteId: siteB, name: "Scope Filter L2" },
      ]);
      const mk = (id: string) => `scope-filter-${id}@shiftly.test`;
      await db.insert(user).values([
        {
          id: ownSiteHo,
          name: "Own Site HO",
          email: mk(ownSiteHo),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: foreignHo,
          name: "Foreign HO",
          email: mk(foreignHo),
          emailVerified: true,
          role: "ho",
          siteId: siteB,
        },
        {
          id: ownSiteLocAdmin,
          name: "Own Site Location Admin",
          email: mk(ownSiteLocAdmin),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: foreignLocAdmin,
          name: "Foreign Location Admin",
          email: mk(foreignLocAdmin),
          emailVerified: true,
          role: "admin",
          siteLocationId: locB,
        },
        {
          id: superadminRow,
          name: "Superadmin Row",
          email: mk(superadminRow),
          emailVerified: true,
          role: "superadmin",
        },
        {
          id: malformedAdmin,
          name: "Malformed Admin",
          email: mk(malformedAdmin),
          emailVerified: true,
          role: "admin",
        },
      ]);

      const hoFilter = userScopeFilter({ role: "ho", siteId: siteA });
      const hoVisible = await db
        .select({ id: user.id })
        .from(user)
        .where(hoFilter);
      expect(hoVisible.map((r) => r.id).sort()).toEqual(
        [ownSiteHo, ownSiteLocAdmin].sort(),
      );

      const saFilter = userScopeFilter({ role: "superadmin", siteId: null });
      expect(saFilter).toBeUndefined();
      const everything = await db.select({ id: user.id }).from(user);
      expect(everything.length).toBeGreaterThanOrEqual(6);
    } finally {
      await db.delete(user).where(eq(user.id, ownSiteHo));
      await db.delete(user).where(eq(user.id, foreignHo));
      await db.delete(user).where(eq(user.id, ownSiteLocAdmin));
      await db.delete(user).where(eq(user.id, foreignLocAdmin));
      await db.delete(user).where(eq(user.id, superadminRow));
      await db.delete(user).where(eq(user.id, malformedAdmin));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteB));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });
});
