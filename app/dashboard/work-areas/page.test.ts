import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { position, site, siteLocation, workArea } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

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
  }>;
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
  // after site A — the default [site, workArea] order holds.
  await db.insert(workArea).values([
    {
      id: waA1,
      siteLocationId: locA1,
      siteId: siteA,
      name: "t7-wa-alpha",
    },
    {
      id: waA2,
      siteLocationId: locA2,
      siteId: siteA,
      name: "t7-wa-own-two",
    },
    {
      id: waB1,
      siteLocationId: locB1,
      siteId: siteB,
      name: "t7-wa-foreign",
    },
  ]);
  return {
    ids: { siteA, siteB, locA1, locA2, locB1, waA1, waA2, waB1 },
    async cleanup() {
      await db.delete(workArea).where(eq(workArea.id, waA1));
      await db.delete(workArea).where(eq(workArea.id, waA2));
      await db.delete(workArea).where(eq(workArea.id, waB1));
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

type DialogOptionsNode = {
  siteLocations: Array<{ id: string; name: string; siteId: string }>;
  sites?: Array<{ id: string; name: string }>;
  positions?: Array<{ id: string; siteId: string }>;
};

// The create dialog travels to the client as the siteLocations/sites props
// on <CreateWorkAreaButton>; the table node carries the same option shape
// too, so the collector keys on the absence of the table-only workAreas.
function collectDialogOptions(
  node: unknown,
  out: DialogOptionsNode[],
): DialogOptionsNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectDialogOptions(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (
    props.props &&
    "siteLocations" in props.props &&
    !("workAreas" in props.props)
  ) {
    out.push(props.props as unknown as DialogOptionsNode);
  }
  collectDialogOptions(props.props?.children, out);
  return out;
}

async function renderDialogOptions(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<DialogOptionsNode> {
  const { default: WorkAreasPage } = await import("./page");
  const tree = await WorkAreasPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectDialogOptions(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// t7- prefixed real-DB fixtures; uuid slices keep suites collision-free.
describe("work-areas page server queries (issue #64)", () => {
  test("admin sees only their own site_location's work areas", async () => {
    const fx = await seedWorkAreaFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("admin", null, fx.ids.locA1);

    const page = await renderWorkAreas();
    expect(page.workAreas.map((w) => w.id)).toEqual([fx.ids.waA1]);
    expect(page.total).toBe(1);
  });

  test("ho sees all work areas under their site across locations, not other sites'", async () => {
    const fx = await seedWorkAreaFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    // A crafted siteId param is ignored for a ho — scope is data-level.
    const crafted = await renderWorkAreas({ siteId: fx.ids.siteB });
    expect(crafted.workAreas.map((w) => w.id)).toEqual([
      fx.ids.waA1,
      fx.ids.waA2,
    ]);
    expect(crafted.total).toBe(2);
  });

  test("superadmin siteId filter keeps only that site's work areas; junk shows all", async () => {
    const fx = await seedWorkAreaFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
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
  });

  test("superadmin SiteFilter receives all site options (no zero-row join)", async () => {
    const fx = await seedWorkAreaFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const page = await renderWorkAreas();
    expect(page.showSiteFilter).toBe(true);
    const siteIds = page.sites?.map((s) => s.id) ?? [];
    expect(siteIds).toContain(fx.ids.siteA);
    expect(siteIds).toContain(fx.ids.siteB);
  });

  test("unbound admin sees nothing", async () => {
    const fx = await seedWorkAreaFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("admin", null, null);

    const page = await renderWorkAreas();
    expect(page.workAreas).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe("work-areas create dialog site options", () => {
  test("a superadmin's dialog receives every site for the site-first pick", async () => {
    const fx = await seedWorkAreaFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const dialog = await renderDialogOptions();
    const siteIds = dialog.sites?.map((s) => s.id) ?? [];
    expect(siteIds).toContain(fx.ids.siteA);
    expect(siteIds).toContain(fx.ids.siteB);
  });

  test("a ho's dialog receives only their own site", async () => {
    const fx = await seedWorkAreaFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const dialog = await renderDialogOptions();
    expect(dialog.sites?.map((s) => s.id)).toEqual([fx.ids.siteA]);
  });
});

describe("work-areas create dialog positions", () => {
  async function seedPositions(fx: Awaited<ReturnType<typeof seedWorkAreaFixtures>>) {
    const posA = randomUUID();
    const posB = randomUUID();
    await db.insert(position).values([
      { id: posA, siteId: fx.ids.siteA, name: `t145-pos-a-${posA}` },
      { id: posB, siteId: fx.ids.siteB, name: `t145-pos-b-${posB}` },
    ]);
    return {
      posA,
      posB,
      async cleanup() {
        await db.delete(position).where(eq(position.id, posA));
        await db.delete(position).where(eq(position.id, posB));
      },
    };
  }

  test("a superadmin's dialog receives the positions of every site", async () => {
    const fx = await seedWorkAreaFixtures();
    const pos = await seedPositions(fx);
    fixtureCleanup.defer(async () => {
      await pos.cleanup();
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const dialog = await renderDialogOptions();
    const ids = dialog.positions?.map((p) => p.id) ?? [];
    expect(ids).toContain(pos.posA);
    expect(ids).toContain(pos.posB);
  });

  test("a ho's dialog receives only their own site's positions", async () => {
    const fx = await seedWorkAreaFixtures();
    const pos = await seedPositions(fx);
    fixtureCleanup.defer(async () => {
      await pos.cleanup();
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const dialog = await renderDialogOptions();
    const ids = dialog.positions?.map((p) => p.id) ?? [];
    expect(ids).toContain(pos.posA);
    expect(ids).not.toContain(pos.posB);
  });

  test("an admin's dialog receives only their location's site positions", async () => {
    const fx = await seedWorkAreaFixtures();
    const pos = await seedPositions(fx);
    fixtureCleanup.defer(async () => {
      await pos.cleanup();
      await fx.cleanup();
    });
    actor = makeActor("admin", null, fx.ids.locA1);

    const dialog = await renderDialogOptions();
    const ids = dialog.positions?.map((p) => p.id) ?? [];
    expect(ids).toContain(pos.posA);
    expect(ids).not.toContain(pos.posB);
  });
});

// The deleted view (?show=deleted) lists soft-deleted work areas inside the
// actor's scope; every other value of show is the live list.
describe("work areas page deleted view", () => {
  type DeletedRow = {
    id: string;
    name: string;
    siteName: string;
    locationName: string;
    deletedAt: string;
  };

  function actorOf(
    role: SessionUser["role"],
    siteId: string | null = null,
    siteLocationId: string | null = null,
  ): SessionUser {
    return {
      id: randomUUID(),
      name: "Area Deleted Actor",
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
    const props = await renderWorkAreas({ show: "deleted", ...searchParams });
    return {
      ...props,
      workAreas: props.workAreas as unknown as DeletedRow[],
    };
  }

  // One site with two locations and work areas seeded straight into the table
  // so each row can carry its own deletedAt. The site name doubles as the
  // search token; `loc` picks which location an area goes under.
  async function seedSiteWith(
    rows: Array<{
      suffix: string;
      deletedAt: Date | null;
      isActive?: boolean;
      loc?: "a" | "b";
    }>,
  ) {
    const siteId = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const token = `t191-page-${randomUUID().slice(0, 8)}`;
    fixtureCleanup.defer(async () => {
      await db.delete(workArea).where(eq(workArea.siteId, siteId));
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: token });
    await db.insert(siteLocation).values([
      { id: locA, siteId, name: `${token}-loc-a` },
      { id: locB, siteId, name: `${token}-loc-b` },
    ]);
    const ids = rows.map(() => randomUUID());
    await db.insert(workArea).values(
      rows.map((row, i) => ({
        id: ids[i],
        siteId,
        siteLocationId: row.loc === "b" ? locB : locA,
        name: `${token}-${row.suffix}`,
        isActive: row.isActive ?? true,
        deletedAt: row.deletedAt,
      })),
    );
    return { siteId, locA, locB, token, ids };
  }

  test("lists only soft-deleted work areas, newest deletion first, with location and date", async () => {
    const { siteId, token, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "older", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "newer", deletedAt: new Date("2026-02-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.workAreas.map((w) => w.id)).toEqual([ids[2], ids[1]]);
    expect(props.workAreas[0].deletedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(props.workAreas[0].siteName).toBe(token);
    expect(props.workAreas[0].locationName).toBe(`${token}-loc-a`);
    expect(props.total).toBe(2);
  });

  test("q narrows within the deleted view", async () => {
    const { token, ids } = await seedSiteWith([
      { suffix: "alpha", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "beta", deletedAt: new Date("2026-01-02T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ q: `${token}-alpha` });

    expect(props.workAreas.map((w) => w.id)).toEqual([ids[0]]);
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

    expect(inactive.workAreas.map((w) => w.id)).toEqual([ids[1]]);
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

    expect(props.workAreas.map((w) => w.id)).toEqual([a.ids[0]]);
    expect(props.workAreas.map((w) => w.id)).not.toContain(b.ids[0]);
  });

  test("sort=name:asc orders by name; sort=deletedAt:asc by date; sort=locationName:desc by location", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "b", deletedAt: new Date("2026-02-01T10:00:00Z"), loc: "a" },
      { suffix: "a", deletedAt: new Date("2026-03-01T10:00:00Z"), loc: "b" },
    ]);
    actor = actorOf("superadmin");

    const byName = await renderDeleted({ siteId, sort: "name:asc" });
    expect(byName.workAreas.map((w) => w.id)).toEqual([ids[1], ids[0]]);

    const byDate = await renderDeleted({ siteId, sort: "deletedAt:asc" });
    expect(byDate.workAreas.map((w) => w.id)).toEqual([ids[0], ids[1]]);

    const byLocation = await renderDeleted({
      siteId,
      sort: "locationName:desc",
    });
    expect(byLocation.workAreas.map((w) => w.id)).toEqual([ids[1], ids[0]]);
  });

  test("work areas deleted at the same instant list by ascending id, whatever the insert order", async () => {
    const sameInstant = new Date("2026-01-01T10:00:00Z");
    const { siteId, ids } = await seedSiteWith(
      Array.from({ length: 4 }, (_, i) => ({
        suffix: `s${i}`,
        deletedAt: sameInstant,
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.workAreas.map((w) => w.id)).toEqual([...ids].sort());
  });

  test("an HO sees only their own site's deleted work areas", async () => {
    const own = await seedSiteWith([
      { suffix: "own", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    const foreign = await seedSiteWith([
      { suffix: "foreign", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("ho", own.siteId);

    // A crafted siteId param must not widen the scope.
    const props = await renderDeleted({ siteId: foreign.siteId });

    expect(props.workAreas.map((w) => w.id)).toEqual([own.ids[0]]);
  });

  test("an admin sees only the deleted work areas of their own location", async () => {
    const seeded = await seedSiteWith([
      { suffix: "mine", deletedAt: new Date("2026-01-01T10:00:00Z"), loc: "a" },
      { suffix: "sibling", deletedAt: new Date("2026-01-02T10:00:00Z"), loc: "b" },
    ]);
    actor = actorOf("admin", seeded.siteId, seeded.locA);

    const props = await renderDeleted({ q: seeded.token });

    expect(props.workAreas.map((w) => w.id)).toEqual([seeded.ids[0]]);
  });

  test("an unbound HO and an unbound admin see nothing", async () => {
    for (const unbound of [actorOf("ho", null), actorOf("admin", null, null)]) {
      actor = unbound;

      const props = await renderDeleted();

      expect(props.workAreas).toEqual([]);
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
    expect(props.workAreas).toHaveLength(2);
  });

  test("no show, an unknown show and a repeated show keep listing live work areas only", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "gone", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    for (const show of [undefined, "bogus", "DELETED", ["deleted", "deleted"]]) {
      const props = await renderWorkAreas({ siteId, show });
      expect(props.workAreas.map((w) => w.id)).toEqual([ids[0]]);
    }
  });
});
