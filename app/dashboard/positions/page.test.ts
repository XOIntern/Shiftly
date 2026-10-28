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

// The deleted view (?show=deleted) lists soft-deleted positions inside the
// actor's scope; every other value of show is the live list.
describe("positions page deleted view", () => {
  type DeletedRow = {
    id: string;
    name: string;
    siteName: string;
    deletedAt: string;
  };

  function actorOf(
    role: SessionUser["role"],
    siteId: string | null = null,
    siteLocationId: string | null = null,
  ): SessionUser {
    return {
      id: randomUUID(),
      name: "Pos Deleted Actor",
      email: `t191-page-${randomUUID()}@shiftly.test`,
      role,
      siteId,
      siteLocationId,
      isActive: true,
    };
  }

  async function renderDeleted(
    searchParams: Record<string, string | string[] | undefined> = {},
  ) {
    const props = await renderPositions({ show: "deleted", ...searchParams });
    return { ...props, positions: props.positions as unknown as DeletedRow[] };
  }

  // One site with positions seeded straight into the table so each row can
  // carry its own deletedAt. The site name doubles as the search token.
  async function seedSiteWith(
    rows: Array<{
      suffix: string;
      deletedAt: Date | null;
      isActive?: boolean;
    }>,
    opts: { siteDeleted?: boolean; withLocation?: boolean } = {},
  ) {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const token = `t191-page-${randomUUID().slice(0, 8)}`;
    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.siteId, siteId));
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({
      id: siteId,
      name: token,
      deletedAt: opts.siteDeleted ? new Date() : null,
    });
    if (opts.withLocation) {
      await db
        .insert(siteLocation)
        .values({ id: locationId, siteId, name: `${token}-loc` });
    }
    const ids = rows.map(() => randomUUID());
    await db.insert(position).values(
      rows.map((row, i) => ({
        id: ids[i],
        siteId,
        name: `${token}-${row.suffix}`,
        isActive: row.isActive ?? true,
        deletedAt: row.deletedAt,
      })),
    );
    return { siteId, locationId, token, ids };
  }

  test("lists only soft-deleted positions, newest deletion first, with the deleted date", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "older", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "newer", deletedAt: new Date("2026-02-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.positions.map((p) => p.id)).toEqual([ids[2], ids[1]]);
    expect(props.positions[0].deletedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(props.total).toBe(2);
  });

  test("a deleted position of a deleted site is still listed", async () => {
    const { siteId, ids } = await seedSiteWith(
      [{ suffix: "orphan", deletedAt: new Date("2026-01-01T10:00:00Z") }],
      { siteDeleted: true },
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.positions.map((p) => p.id)).toEqual([ids[0]]);
  });

  test("q narrows within the deleted view", async () => {
    const { token, ids } = await seedSiteWith([
      { suffix: "alpha", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "beta", deletedAt: new Date("2026-01-02T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ q: `${token}-alpha` });

    expect(props.positions.map((p) => p.id)).toEqual([ids[0]]);
  });

  test("the status filter applies to the deleted list too", async () => {
    const { siteId, ids } = await seedSiteWith([
      {
        suffix: "on",
        deletedAt: new Date("2026-01-01T10:00:00Z"),
        isActive: true,
      },
      {
        suffix: "off",
        deletedAt: new Date("2026-01-02T10:00:00Z"),
        isActive: false,
      },
    ]);
    actor = actorOf("superadmin");

    const inactive = await renderDeleted({ siteId, status: "inactive" });

    expect(inactive.positions.map((p) => p.id)).toEqual([ids[1]]);
  });

  test("the site filter applies to the deleted list for a superadmin", async () => {
    const a = await seedSiteWith([
      { suffix: "a", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    const b = await seedSiteWith([
      { suffix: "b", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId: a.siteId });

    expect(props.positions.map((p) => p.id)).toEqual([a.ids[0]]);
    expect(props.positions.map((p) => p.id)).not.toContain(b.ids[0]);
  });

  test("sort=name:asc orders the deleted rows by name; sort=deletedAt:asc by date", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "b", deletedAt: new Date("2026-02-01T10:00:00Z") },
      { suffix: "a", deletedAt: new Date("2026-03-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const byName = await renderDeleted({ siteId, sort: "name:asc" });
    expect(byName.positions.map((p) => p.id)).toEqual([ids[1], ids[0]]);

    const byDate = await renderDeleted({ siteId, sort: "deletedAt:asc" });
    expect(byDate.positions.map((p) => p.id)).toEqual([ids[0], ids[1]]);
  });

  test("positions deleted at the same instant list by ascending id, whatever the insert order", async () => {
    const sameInstant = new Date("2026-01-01T10:00:00Z");
    const { siteId, ids } = await seedSiteWith(
      Array.from({ length: 4 }, (_, i) => ({
        suffix: `s${i}`,
        deletedAt: sameInstant,
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.positions.map((p) => p.id)).toEqual([...ids].sort());
  });

  test("an HO sees only their own site's deleted positions", async () => {
    const own = await seedSiteWith([
      { suffix: "own", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    const foreign = await seedSiteWith([
      { suffix: "foreign", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("ho", own.siteId);

    // A crafted siteId param must not widen the scope.
    const props = await renderDeleted({ siteId: foreign.siteId });

    expect(props.positions.map((p) => p.id)).toEqual([own.ids[0]]);
  });

  test("an admin sees the deleted positions of their location's site only", async () => {
    const own = await seedSiteWith(
      [{ suffix: "own", deletedAt: new Date("2026-01-01T10:00:00Z") }],
      { withLocation: true },
    );
    const foreign = await seedSiteWith([
      { suffix: "foreign", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("admin", own.siteId, own.locationId);

    const props = await renderDeleted({ siteId: foreign.siteId });

    expect(props.positions.map((p) => p.id)).toEqual([own.ids[0]]);
  });

  test("an unbound HO and an unbound admin see nothing", async () => {
    for (const unbound of [actorOf("ho", null), actorOf("admin", null, null)]) {
      actor = unbound;

      const props = await renderDeleted();

      expect(props.positions).toEqual([]);
      expect(props.total).toBe(0);
    }
  });

  test("pagination math holds in the deleted view", async () => {
    const { siteId } = await seedSiteWith(
      Array.from({ length: 12 }, (_, i) => ({
        suffix: String(i).padStart(2, "0"),
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId, page: "999" });

    expect(props.total).toBe(12);
    expect(props.pageCount).toBe(2);
    expect(props.positions).toHaveLength(2);
  });

  test("no show, an unknown show and a repeated show keep listing live positions only", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "gone", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    for (const show of [undefined, "bogus", "DELETED", ["deleted", "deleted"]]) {
      const props = await renderPositions({ siteId, show });
      expect(props.positions.map((p) => p.id)).toEqual([ids[0]]);
    }
  });
});
