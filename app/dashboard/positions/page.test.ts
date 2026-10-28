import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { position, site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The positions page reads its actor through requireUser (all three roles
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

type PositionNode = {
  positions: Array<{
    id: string;
    name: string;
    siteName: string;
  }>;
  sites?: Array<{ id: string; name: string }>;
  showSiteFilter?: boolean;
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the positions travel to the client
// table as the positions/pageCount/total props on <PositionsTable>.
function collectPositions(node: unknown, out: PositionNode[]): PositionNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectPositions(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "positions" in props.props) {
    out.push(props.props as unknown as PositionNode);
    collectPositions(props.props.children, out);
  } else if (props.props) {
    collectPositions(props.props.children, out);
  }
  return out;
}

async function renderPositions(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<PositionNode> {
  const { default: PositionsPage } = await import("./page");
  const tree = await PositionsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectPositions(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// Shared fixture: site A (location LA for admin bindings) holds PA1 and
// PA2; site B holds PB1. Site C is soft-deleted and holds the live+active
// PC1, which must never reach the list. Child-first cleanup.
async function seedPositionFixtures() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const siteC = randomUUID();
  const locA1 = randomUUID();
  const locC = randomUUID();
  const posA1 = randomUUID();
  const posA2 = randomUUID();
  const posB1 = randomUUID();
  const posC1 = randomUUID();
  await db.insert(site).values([
    { id: siteA, name: `t9-pos-site-a-${siteA}` },
    { id: siteB, name: `t9-pos-site-b-${siteB}` },
    { id: siteC, name: `t9-pos-site-c-${siteC}`, deletedAt: new Date() },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t9-pos-loc-a1-${locA1}` },
    { id: locC, siteId: siteC, name: `t9-pos-loc-c-${locC}` },
  ]);
  // The site names embed their uuids, so site B is always alphabetically
  // after site A — the default [site, position] order holds.
  await db.insert(position).values([
    { id: posA1, siteId: siteA, name: "t9-pos-alpha" },
    { id: posA2, siteId: siteA, name: "t9-pos-own-two" },
    { id: posB1, siteId: siteB, name: "t9-pos-foreign" },
    { id: posC1, siteId: siteC, name: "t9-pos-soft-deleted" },
  ]);
  return {
    ids: { siteA, siteB, siteC, locA1, locC, posA1, posA2, posB1, posC1 },
    async cleanup() {
      await db.delete(position).where(eq(position.id, posA1));
      await db.delete(position).where(eq(position.id, posA2));
      await db.delete(position).where(eq(position.id, posB1));
      await db.delete(position).where(eq(position.id, posC1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locC));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
      await db.delete(site).where(eq(site.id, siteC));
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
    name: "T9 Position Actor",
    email: `t9-pos-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// t9- prefixed real-DB fixtures; uuid slices keep suites collision-free.
describe("positions page server queries", () => {
  test("admin sees only positions under their binding's site", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("admin", null, fx.ids.locA1);

    const page = await renderPositions();
    expect(page.positions.map((p) => p.id)).toEqual([
      fx.ids.posA1,
      fx.ids.posA2,
    ]);
    expect(page.total).toBe(2);
  });

  test("ho sees all positions under their site, not other sites'", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    // A crafted siteId param is ignored for a ho — scope is data-level.
    const crafted = await renderPositions({ siteId: fx.ids.siteB });
    expect(crafted.positions.map((p) => p.id)).toEqual([
      fx.ids.posA1,
      fx.ids.posA2,
    ]);
    expect(crafted.total).toBe(2);
  });

  test("superadmin siteId filter keeps only that site's positions; junk shows all", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    // Shared dev DB: other suites' positions may exist, so the
    // unfiltered and junk renders assert presence, while the filtered
    // one is exact.
    const filtered = await renderPositions({ siteId: fx.ids.siteA });
    expect(filtered.positions.map((p) => p.id)).toEqual([
      fx.ids.posA1,
      fx.ids.posA2,
    ]);
    expect(filtered.total).toBe(2);

    const junk = await renderPositions({ siteId: "junk" as never });
    const junkIds = junk.positions.map((p) => p.id);
    expect(junkIds).toContain(fx.ids.posA1);
    expect(junkIds).toContain(fx.ids.posA2);
    expect(junkIds).toContain(fx.ids.posB1);
  });

  test("superadmin SiteFilter receives all site options (no zero-row join)", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const page = await renderPositions();
    expect(page.showSiteFilter).toBe(true);
    const siteIds = page.sites?.map((s) => s.id) ?? [];
    expect(siteIds).toContain(fx.ids.siteA);
    expect(siteIds).toContain(fx.ids.siteB);
  });

  test("pickers exclude positions under a soft-deleted site", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const page = await renderPositions({ pageSize: "50" });
    const positionIds = page.positions.map((p) => p.id);
    // Shared dev DB: other suites' live positions may exist, so assert
    // presence rather than an exact array.
    expect(positionIds).toContain(fx.ids.posA1);
    expect(positionIds).not.toContain(fx.ids.posC1);
  });

  test("unbound admin sees nothing", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("admin", null, null);

    const page = await renderPositions();
    expect(page.positions).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe("positions create dialog site options", () => {
  test("a superadmin's dialog receives every site for the site pick", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const page = await renderPositions();
    const siteIds = page.sites?.map((s) => s.id) ?? [];
    expect(siteIds).toContain(fx.ids.siteA);
    expect(siteIds).toContain(fx.ids.siteB);
  });

  test("a ho's dialog receives only their own site", async () => {
    const fx = await seedPositionFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const page = await renderPositions();
    expect(page.sites?.map((s) => s.id)).toEqual([fx.ids.siteA]);
  });
});
