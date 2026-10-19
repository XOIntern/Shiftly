import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  position,
  site,
  siteLocation,
  worker,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The workers page reads its actor through requireUser (all three roles
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

type WorkerNode = {
  workers: Array<{
    id: string;
    employeeId: string;
    siteName: string;
  }>;
  sites?: Array<{ id: string; name: string }>;
  siteLocations?: Array<{ id: string; name: string; siteId: string }>;
  positions?: Array<{ id: string; name: string; siteId: string; isActive: boolean }>;
  showSiteFilter?: boolean;
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the workers travel to the client
// table as the workers/pageCount/total props on <WorkersTable>.
function collectWorkers(node: unknown, out: WorkerNode[]): WorkerNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectWorkers(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "workers" in props.props) {
    out.push(props.props as unknown as WorkerNode);
    collectWorkers(props.props.children, out);
  } else if (props.props) {
    collectWorkers(props.props.children, out);
  }
  return out;
}

async function renderWorkers(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<WorkerNode> {
  const { default: WorkersPage } = await import("./page");
  const tree = await WorkersPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectWorkers(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// Shared fixture: site A (location LA1, the admin binding site) holds the
// live position PA plus the inactive PA-off; site B (location LB) holds PB
// and the worker W2. The workers W1/W2 sit under LA1/LB respectively.
// Child-first cleanup.
async function seedWorkerFixtures() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locB = randomUUID();
  const posA = randomUUID();
  const posAOff = randomUUID();
  const posB = randomUUID();
  const wA = randomUUID();
  const wB = randomUUID();
  await db.insert(site).values([
    { id: siteA, name: `t13-wpage-site-a-${siteA}` },
    { id: siteB, name: `t13-wpage-site-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t13-wpage-loc-a1-${locA1}` },
    { id: locB, siteId: siteB, name: `t13-wpage-loc-b-${locB}` },
  ]);
  // The site names embed their uuids, so site B is always alphabetically
  // after site A — the default [site, employeeId] order holds.
  await db.insert(position).values([
    { id: posA, siteId: siteA, name: "t13-wpage-alpha" },
    { id: posAOff, siteId: siteA, name: "t13-wpage-off", isActive: false },
    { id: posB, siteId: siteB, name: "t13-wpage-foreign-b" },
  ]);
  await db.insert(worker).values([
    {
      id: wA,
      siteId: siteA,
      siteLocationId: locA1,
      positionId: posA,
      employeeId: `t13-wpage-emp-a-${wA.slice(0, 8)}`,
      name: "t13-wpage-worker-a",
    },
    {
      id: wB,
      siteId: siteB,
      siteLocationId: locB,
      positionId: posB,
      employeeId: `t13-wpage-emp-b-${wB.slice(0, 8)}`,
      name: "t13-wpage-worker-b",
    },
  ]);
  return {
    ids: { siteA, siteB, locA1, locB, posA, posAOff, posB, wA, wB },
    async cleanup() {
      await db.delete(worker).where(eq(worker.id, wA));
      await db.delete(worker).where(eq(worker.id, wB));
      await db.delete(position).where(eq(position.id, posA));
      await db.delete(position).where(eq(position.id, posAOff));
      await db.delete(position).where(eq(position.id, posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
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
    name: "T13 Worker Actor",
    email: `t13-wpage-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// t13- prefixed real-DB fixtures; uuid slices keep suites collision-free.
describe("workers page server queries", () => {
  test("admin sees only workers in their binding location", async () => {
    const fx = await seedWorkerFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locA1);

      const page = await renderWorkers();
      expect(page.workers.map((w) => w.id)).toEqual([fx.ids.wA]);
      expect(page.total).toBe(1);
    } finally {
      await fx.cleanup();
    }
  });

  test("ho sees all workers under their site, not other sites'", async () => {
    const fx = await seedWorkerFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      // A crafted siteId param is ignored for a ho — scope is data-level.
      const crafted = await renderWorkers({ siteId: fx.ids.siteB });
      expect(crafted.workers.map((w) => w.id)).toEqual([fx.ids.wA]);
      expect(crafted.total).toBe(1);
    } finally {
      await fx.cleanup();
    }
  });

  test("superadmin siteId filter keeps only that site's workers; junk shows all", async () => {
    const fx = await seedWorkerFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      // Shared dev DB: other suites' workers may exist, so the unfiltered
      // and junk renders assert presence, while the filtered one is exact.
      const filtered = await renderWorkers({ siteId: fx.ids.siteA });
      expect(filtered.workers.map((w) => w.id)).toEqual([fx.ids.wA]);
      expect(filtered.total).toBe(1);

      const junk = await renderWorkers({ siteId: "junk" as never });
      const junkIds = junk.workers.map((w) => w.id);
      expect(junkIds).toContain(fx.ids.wA);
      expect(junkIds).toContain(fx.ids.wB);
    } finally {
      await fx.cleanup();
    }
  });

  test("dialog receives the role-scoped site, location, and position options", async () => {
    const fx = await seedWorkerFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const page = await renderWorkers();
      // CreateWorkerButton and WorkersTable receive the same fixture
      // props, asserted on the table node.
      expect(page.sites?.map((s) => s.id)).toEqual([fx.ids.siteA]);
      expect(
        (page.siteLocations ?? []).every((l) => l.siteId === fx.ids.siteA),
      ).toBe(true);
      expect(page.siteLocations?.map((l) => l.id)).toEqual([fx.ids.locA1]);
      // Position options are pre-filtered live+active: the inactive one
      // never reaches the picker, and site B's is scoped out.
      const positionIds = (page.positions ?? []).map((p) => p.id);
      expect(positionIds).toEqual([fx.ids.posA]);
      expect(positionIds).not.toContain(fx.ids.posAOff);
      expect(
        (page.positions ?? []).every((p) => p.siteId === fx.ids.siteA),
      ).toBe(true);
    } finally {
      await fx.cleanup();
    }
  });

  test("unbound admin sees nothing", async () => {
    const fx = await seedWorkerFixtures();
    try {
      actor = makeActor("admin", null, null);

      const page = await renderWorkers();
      expect(page.workers).toEqual([]);
      expect(page.total).toBe(0);
    } finally {
      await fx.cleanup();
    }
  });
});
