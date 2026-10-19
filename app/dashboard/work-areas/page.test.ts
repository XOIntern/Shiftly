import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { department, site, siteLocation, workArea } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The work-areas page reads its actor through requireUser (all three roles
// manage their own scope) — swapped for a stub so the real server component
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

type WorkAreaNode = {
  workAreas: Array<{
    id: string;
    name: string;
    siteName: string;
    departmentName: string;
  }>;
  departments?: Array<{ id: string; name: string }>;
  siteLocations?: Array<{ id: string; name: string }>;
  sites?: Array<{ id: string; name: string }>;
  showSiteFilter?: boolean;
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the work areas travel to the client
// table as the workAreas/pageCount/total props on <WorkAreasTable>.
function collectWorkAreas(node: unknown, out: WorkAreaNode[]): WorkAreaNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectWorkAreas(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "workAreas" in props.props) {
    out.push(props.props as unknown as WorkAreaNode);
    collectWorkAreas(props.props.children, out);
  } else if (props.props) {
    collectWorkAreas(props.props.children, out);
  }
  return out;
}

async function renderWorkAreas(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<WorkAreaNode> {
  const { default: WorkAreasPage } = await import("./page");
  const tree = await WorkAreasPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectWorkAreas(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// Shared fixture: site A (locations LA1, LA2) holds WA1 under LA1 and WA2
// under LA2; site B (location LB1) holds WB1. Child-first cleanup.
async function seedWorkAreaFixtures() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locA2 = randomUUID();
  const locB1 = randomUUID();
  const depA = randomUUID();
  const depB = randomUUID();
  const waA1 = randomUUID();
  const waA2 = randomUUID();
  const waB1 = randomUUID();
  await db.insert(site).values([
    { id: siteA, name: `t7-wa-site-a-${siteA}` },
    { id: siteB, name: `t7-wa-site-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t7-wa-loc-a1-${locA1}` },
    { id: locA2, siteId: siteA, name: `t7-wa-loc-a2-${locA2}` },
    { id: locB1, siteId: siteB, name: `t7-wa-loc-b1-${locB1}` },
  ]);
  // The site names embed their uuids, so site B is always alphabetically
  // after site A — the default [site, department, workArea] order holds.
  await db.insert(department).values([
    { id: depA, siteId: siteA, name: `t7-wa-dep-a-${depA}` },
    { id: depB, siteId: siteB, name: `t7-wa-dep-b-${depB}` },
  ]);
  await db.insert(workArea).values([
    {
      id: waA1,
      departmentId: depA,
      siteLocationId: locA1,
      siteId: siteA,
      name: "t7-wa-alpha",
    },
    {
      id: waA2,
      departmentId: depA,
      siteLocationId: locA2,
      siteId: siteA,
      name: "t7-wa-own-two",
    },
    {
      id: waB1,
      departmentId: depB,
      siteLocationId: locB1,
      siteId: siteB,
      name: "t7-wa-foreign",
    },
  ]);
  return {
    ids: { siteA, siteB, locA1, locA2, locB1, depA, depB, waA1, waA2, waB1 },
    async cleanup() {
      await db.delete(workArea).where(eq(workArea.id, waA1));
      await db.delete(workArea).where(eq(workArea.id, waA2));
      await db.delete(workArea).where(eq(workArea.id, waB1));
      await db.delete(department).where(eq(department.id, depA));
      await db.delete(department).where(eq(department.id, depB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB1));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    },
  };
}

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T7 WA Actor",
    email: `t7-wa-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// t7- prefixed real-DB fixtures; uuid slices keep suites collision-free.
describe("work-areas page server queries (issue #64)", () => {
  test("admin sees only their own site_location's work areas", async () => {
    const fx = await seedWorkAreaFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locA1);

      const page = await renderWorkAreas();
      expect(page.workAreas.map((w) => w.id)).toEqual([fx.ids.waA1]);
      expect(page.total).toBe(1);
    } finally {
      await fx.cleanup();
    }
  });

  test("ho sees all work areas under their site across locations, not other sites'", async () => {
    const fx = await seedWorkAreaFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      // A crafted siteId param is ignored for a ho — scope is data-level.
      const crafted = await renderWorkAreas({ siteId: fx.ids.siteB });
      expect(crafted.workAreas.map((w) => w.id)).toEqual([
        fx.ids.waA1,
        fx.ids.waA2,
      ]);
      expect(crafted.total).toBe(2);
    } finally {
      await fx.cleanup();
    }
  });

  test("superadmin siteId filter keeps only that site's work areas; junk shows all", async () => {
    const fx = await seedWorkAreaFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      // Shared dev DB: other suites' work areas may exist, so the
      // unfiltered and junk renders assert presence, while the filtered
      // one is exact.
      const filtered = await renderWorkAreas({ siteId: fx.ids.siteA });
      expect(filtered.workAreas.map((w) => w.id)).toEqual([
        fx.ids.waA1,
        fx.ids.waA2,
      ]);
      expect(filtered.total).toBe(2);

      const junk = await renderWorkAreas({ siteId: "junk" as never });
      const junkIds = junk.workAreas.map((w) => w.id);
      expect(junkIds).toContain(fx.ids.waA1);
      expect(junkIds).toContain(fx.ids.waA2);
      expect(junkIds).toContain(fx.ids.waB1);
    } finally {
      await fx.cleanup();
    }
  });

  test("superadmin SiteFilter receives all site options (no zero-row join)", async () => {
    const fx = await seedWorkAreaFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      const page = await renderWorkAreas();
      expect(page.showSiteFilter).toBe(true);
      const siteIds = page.sites?.map((s) => s.id) ?? [];
      expect(siteIds).toContain(fx.ids.siteA);
      expect(siteIds).toContain(fx.ids.siteB);
    } finally {
      await fx.cleanup();
    }
  });

  test("unbound admin sees nothing", async () => {
    const fx = await seedWorkAreaFixtures();
    try {
      actor = makeActor("admin", null, null);

      const page = await renderWorkAreas();
      expect(page.workAreas).toEqual([]);
      expect(page.total).toBe(0);
    } finally {
      await fx.cleanup();
    }
  });
});
