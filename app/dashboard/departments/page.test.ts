import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { department, site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/lib/session";

// The departments page reads its actor through requireUser (admins get
// view-only access here) — swapped for a stub so the real server component
// can render against the test database. The mock swaps the WHOLE module
// across bun's single test process, so every export other suites may
// resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

type DepartmentNode = {
  departments: Array<{
    id: string;
    name: string;
    siteName: string;
  }>;
  sites: Array<{ id: string; name: string }>;
  canManage?: boolean;
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the departments travel to the client
// table as the departments/canManage/pageCount/total props on
// <DepartmentsTable>.
function collectDepartments(node: unknown, out: DepartmentNode[]): DepartmentNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectDepartments(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "departments" in props.props) {
    out.push(props.props as unknown as DepartmentNode);
    collectDepartments(props.props.children, out);
  } else if (props.props) {
    collectDepartments(props.props.children, out);
  }
  return out;
}

async function renderDepartments(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<DepartmentNode> {
  const { default: DepartmentsPage } = await import("./page");
  const tree = await DepartmentsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectDepartments(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// t6- prefixed real-DB fixtures; uuid slices keep suites collision-free.
describe("departments page server queries (issue #63)", () => {
  test("superadmin siteId filter keeps only that site's departments; junk shows all", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const depA = randomUUID();
    const depB = randomUUID();
    try {
      await db.insert(site).values([
        { id: siteA, name: `t6-dep-site-a-${siteA}` },
        { id: siteB, name: `t6-dep-site-b-${siteB}` },
      ]);
      await db.insert(department).values([
        { id: depA, siteId: siteA, name: "t6-dep-alpha" },
        { id: depB, siteId: siteB, name: "t6-dep-beta" },
      ]);

      actor = {
        id: randomUUID(),
        name: "T6 Dep Sa",
        email: `t6-dep-${randomUUID()}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      // Shared dev DB: other suites' departments may exist, so the
      // unfiltered and junk renders assert presence, while the filtered
      // one is exact.
      const all = await renderDepartments();
      const allIds = all.departments.map((d) => d.id);
      expect(allIds).toContain(depA);
      expect(allIds).toContain(depB);

      const filtered = await renderDepartments({ siteId: siteA });
      expect(filtered.departments.map((d) => d.id)).toEqual([depA]);
      expect(filtered.total).toBe(1);

      // Whitelist (uuid shape): anything else parses to no filter.
      const junk = await renderDepartments({ siteId: "junk" as never });
      const junkIds = junk.departments.map((d) => d.id);
      expect(junkIds).toContain(depA);
      expect(junkIds).toContain(depB);
    } finally {
      await db.delete(department).where(eq(department.id, depA));
      await db.delete(department).where(eq(department.id, depB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("ho sees only their own site's departments", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const depA = randomUUID();
    const depB = randomUUID();
    try {
      await db.insert(site).values([
        { id: siteA, name: `t6-dep-site-a-${siteA}` },
        { id: siteB, name: `t6-dep-site-b-${siteB}` },
      ]);
      await db.insert(department).values([
        { id: depA, siteId: siteA, name: "t6-dep-own" },
        { id: depB, siteId: siteB, name: "t6-dep-foreign" },
      ]);

      actor = {
        id: randomUUID(),
        name: "T6 Dep Ho",
        email: `t6-dep-${randomUUID()}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      // A crafted siteId param is ignored for a ho — scope is data-level.
      const crafted = await renderDepartments({ siteId: siteB });
      expect(crafted.departments.map((d) => d.id)).toEqual([depA]);
      expect(crafted.canManage).toBe(true);
    } finally {
      await db.delete(department).where(eq(department.id, depA));
      await db.delete(department).where(eq(department.id, depB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("admin sees their location's site's departments with canManage: false", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const siteLocationA = randomUUID();
    const depA = randomUUID();
    const depB = randomUUID();
    try {
      await db.insert(site).values([
        { id: siteA, name: `t6-dep-site-a-${siteA}` },
        { id: siteB, name: `t6-dep-site-b-${siteB}` },
      ]);
      await db.insert(siteLocation).values([
        { id: siteLocationA, siteId: siteA, name: "t6-dep-loc" },
      ]);
      await db.insert(department).values([
        { id: depA, siteId: siteA, name: "t6-dep-admins-site" },
        { id: depB, siteId: siteB, name: "t6-dep-other-site" },
      ]);

      actor = {
        id: randomUUID(),
        name: "T6 Dep Admin",
        email: `t6-dep-${randomUUID()}@shiftly.test`,
        role: "admin",
        siteId: null,
        siteLocationId: siteLocationA,
        isActive: true,
      };

      const props = await renderDepartments();
      const ids = props.departments.map((d) => d.id);
      expect(ids).toEqual([depA]);
      expect(props.canManage).toBe(false);
    } finally {
      await db.delete(department).where(eq(department.id, depA));
      await db.delete(department).where(eq(department.id, depB));
      await db.delete(siteLocation).where(eq(siteLocation.id, siteLocationA));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("unbound ho and unbound admin each see nothing", async () => {
    const siteA = randomUUID();
    const depA = randomUUID();
    try {
      await db.insert(site).values([{ id: siteA, name: `t6-dep-site-${siteA}` }]);
      await db
        .insert(department)
        .values([{ id: depA, siteId: siteA, name: "t6-dep-anywhere" }]);

      actor = {
        id: randomUUID(),
        name: "T6 Dep Ho Unbound",
        email: `t6-dep-${randomUUID()}@shiftly.test`,
        role: "ho",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };
      const hoProps = await renderDepartments();
      expect(hoProps.departments).toEqual([]);
      expect(hoProps.total).toBe(0);

      actor = {
        id: randomUUID(),
        name: "T6 Dep Admin Unbound",
        email: `t6-dep-${randomUUID()}@shiftly.test`,
        role: "admin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };
      const adminProps = await renderDepartments();
      expect(adminProps.departments).toEqual([]);
      expect(adminProps.total).toBe(0);
      expect(adminProps.canManage).toBe(false);
    } finally {
      await db.delete(department).where(eq(department.id, depA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });
});
