import { describe, expect, test } from "bun:test";
import { canManageUser, scopeOf } from "./scope";
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
