import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The locations page reads its actor through requireHO — swapped for a
// stub so the real server component can render against the test database.
// The mock swaps the WHOLE module across bun's single test process, so
// every export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

type LocationNode = {
  locations: Array<{
    id: string;
    name: string;
    siteName: string;
    timezone: string;
  }>;
  sites: Array<{ id: string; name: string }>;
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the locations travel to the client
// table as the locations/pageCount/total props on <LocationsTable>.
function collectLocations(node: unknown, out: LocationNode[]): LocationNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectLocations(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "locations" in props.props) {
    out.push(props.props as unknown as LocationNode);
    collectLocations(props.props.children, out);
  } else if (props.props) {
    collectLocations(props.props.children, out);
  }
  return out;
}

async function renderLocations(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<LocationNode> {
  const { default: LocationsPage } = await import("./page");
  const tree = await LocationsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectLocations(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// t3- prefixed real-DB fixtures; uuid slices keep suites collision-free.
describe("locations page server queries (issue #21)", () => {
  test("superadmin siteId filter keeps only that site's locations; junk shows all", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    });
    await db.insert(site).values([
      { id: siteA, name: `t4-loc-site-a-${siteA}` },
      { id: siteB, name: `t4-loc-site-b-${siteB}` },
    ]);
    await db.insert(siteLocation).values([
      { id: locA, siteId: siteA, name: "t4-loc-alpha" },
      { id: locB, siteId: siteB, name: "t4-loc-beta" },
    ]);

    actor = {
      id: randomUUID(),
      name: "T4 Loc Sa",
      email: `t4-loc-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };

    // Shared dev DB: other suites' locations may exist, so the unfiltered
    // and junk renders assert presence, while the filtered one is exact.
    const all = await renderLocations();
    const allIds = all.locations.map((l) => l.id);
    expect(allIds).toContain(locA);
    expect(allIds).toContain(locB);

    const filtered = await renderLocations({ siteId: siteA });
    expect(filtered.locations.map((l) => l.id)).toEqual([locA]);
    expect(filtered.total).toBe(1);

    // Whitelist (uuid shape): anything else parses to no filter.
    const junk = await renderLocations({ siteId: "junk" as never });
    const junkIds = junk.locations.map((l) => l.id);
    expect(junkIds).toContain(locA);
    expect(junkIds).toContain(locB);
  });

  test("a ho's siteId param is ignored — scope keeps its own site's rows", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    });
    await db.insert(site).values([
      { id: siteA, name: `t4-loc-site-a-${siteA}` },
      { id: siteB, name: `t4-loc-site-b-${siteB}` },
    ]);
    await db.insert(siteLocation).values([
      { id: locA, siteId: siteA, name: "t4-loc-own" },
      { id: locB, siteId: siteB, name: "t4-loc-foreign" },
    ]);

    actor = {
      id: randomUUID(),
      name: "T4 Loc Ho",
      email: `t4-loc-${randomUUID()}@shiftly.test`,
      role: "ho",
      siteId: siteA,
      siteLocationId: null,
      isActive: true,
    };

    const crafted = await renderLocations({ siteId: siteB });
    expect(crafted.locations.map((l) => l.id)).toEqual([locA]);
  });

  test("each row carries its location's time zone to the table", async () => {
    const siteA = randomUUID();
    const locJakarta = randomUUID();
    const locMakassar = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteA));
      await db.delete(site).where(eq(site.id, siteA));
    });
    await db
      .insert(site)
      .values({ id: siteA, name: `t4-loc-site-tz-${siteA}` });
    await db.insert(siteLocation).values([
      { id: locJakarta, siteId: siteA, name: "t4-loc-tz-jkt" },
      {
        id: locMakassar,
        siteId: siteA,
        name: "t4-loc-tz-mks",
        timezone: "Asia/Makassar",
      },
    ]);

    actor = {
      id: randomUUID(),
      name: "T4 Loc Ho",
      email: `t4-loc-${randomUUID()}@shiftly.test`,
      role: "ho",
      siteId: siteA,
      siteLocationId: null,
      isActive: true,
    };

    const rendered = await renderLocations();
    const zoneOf = (id: string) =>
      rendered.locations.find((l) => l.id === id)?.timezone;
    expect(zoneOf(locJakarta)).toBe("Asia/Jakarta");
    expect(zoneOf(locMakassar)).toBe("Asia/Makassar");
  });

  test("ho actor: search matches name only (address field removed), scoped to its site", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA_name = randomUUID();
    const locB_address = randomUUID();
    const locC_other = randomUUID();
    const locD_foreign = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA_name));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB_address));
      await db.delete(siteLocation).where(eq(siteLocation.id, locC_other));
      await db.delete(siteLocation).where(eq(siteLocation.id, locD_foreign));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    });
    await db.insert(site).values([
      { id: siteA, name: `t3-loc-site-a-${siteA}` },
      { id: siteB, name: `t3-loc-site-b-${siteB}` },
    ]);
    await db.insert(siteLocation).values([
      // Matched via its name; the token only appears there.
      {
        id: locA_name,
        siteId: siteA,
        name: `t3-loc-name-${randomUUID().slice(0, 6)}`,
      },
      // Once held the token in its address only — must NOT match now.
      {
        id: locB_address,
        siteId: siteA,
        name: "unrelated name",
      },
      // No match for the token.
      {
        id: locC_other,
        siteId: siteA,
        name: "unrelated name 2",
      },
      // Same token but on a foreign site — a ho must never see it.
      {
        id: locD_foreign,
        siteId: siteB,
        name: `t3-loc-name-foreign`,
      },
    ]);

    actor = {
      id: randomUUID(),
      name: "Loc Ho Actor",
      email: `t3-loc-${randomUUID()}@shiftly.test`,
      role: "ho",
      siteId: siteA,
      siteLocationId: null,
      isActive: true,
    };
    const token = "t3-loc-name";
    const props = await renderLocations({ q: token });

    const matched = props.locations.map((l) => l.id).sort();
    expect(matched).toEqual([locA_name]);
    expect(props.total).toBe(1);
    expect(props.pageCount).toBe(1);
  });

  test("a ho without a binding sees nothing, even with a search", async () => {
    actor = {
      id: randomUUID(),
      name: "Loc Ho Unguarded",
      email: `t3-loc-${randomUUID()}@shiftly.test`,
      role: "ho",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderLocations({ q: "anything" });
    expect(props.locations).toEqual([]);
    expect(props.total).toBe(0);
    expect(props.pageCount).toBe(1);
  });

  test("status filter keeps only active or inactive rows; junk shows all", async () => {
    const siteA = randomUUID();
    const locActive = randomUUID();
    const locInactive = randomUUID();
    const token = `t3-loc-status-${randomUUID().slice(0, 8)}`;
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteA));
      await db.delete(site).where(eq(site.id, siteA));
    });
    await db.insert(site).values([{ id: siteA, name: token }]);
    await db.insert(siteLocation).values([
      { id: locActive, siteId: siteA, name: `${token}-on`, isActive: true },
      {
        id: locInactive,
        siteId: siteA,
        name: `${token}-off`,
        isActive: false,
      },
    ]);

    actor = {
      id: randomUUID(),
      name: "Loc Status Actor",
      email: `t3-loc-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };

    const all = await renderLocations({ q: token });
    expect(all.locations.map((l) => l.id).sort()).toEqual(
      [locActive, locInactive].sort(),
    );

    const active = await renderLocations({ q: token, status: "active" });
    expect(active.locations.map((l) => l.id)).toEqual([locActive]);
    expect(active.total).toBe(1);

    const inactive = await renderLocations({ q: token, status: "inactive" });
    expect(inactive.locations.map((l) => l.id)).toEqual([locInactive]);
    expect(inactive.total).toBe(1);

    // Whitelist: anything else parses to no filter.
    const junk = await renderLocations({ q: token, status: "junk" as never });
    expect(junk.locations).toHaveLength(2);
  });

  test("sort=siteName orders by the joined site name; bogus falls back", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    });
    await db.insert(site).values([
      { id: siteA, name: `t3-loc-site-alpha-${randomUUID().slice(0, 6)}` },
      { id: siteB, name: `t3-loc-site-beta-${randomUUID().slice(0, 6)}` },
    ]);
    await db.insert(siteLocation).values([
      // Names reversed relative to site names to expose join ordering.
      { id: locA, siteId: siteB, name: "t3-loc-zeta" },
      { id: locB, siteId: siteA, name: "t3-loc-alpha" },
    ]);

    actor = {
      id: randomUUID(),
      name: "Loc Sa Actor",
      email: `t3-loc-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const queried = await renderLocations({
      q: "t3-loc-",
      sort: "siteName",
      dir: "desc",
    });
    const order = queried.locations.map((l) => l.id);
    expect(order).toEqual([locA, locB]);

    const defaulted = await renderLocations({
      q: "t3-loc-",
      sort: "bogus" as never,
    });
    // Default: site name asc — alpha lands before beta regardless of the
    // uuid suffix — then location name.
    expect(defaulted.locations.map((l) => l.id)).toEqual([locB, locA]);
  });

  test("multi-sort: the second key orders within ties of the first", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const token = `t3-loc-multi-${randomUUID().slice(0, 8)}`;
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteA));
      await db.delete(site).where(eq(site.id, siteA));
    });
    // One site, two locations: siteName alone ties them, so only the
    // explicit second key (name desc) can produce this order.
    await db.insert(site).values([{ id: siteA, name: token }]);
    await db.insert(siteLocation).values([
      { id: locA, siteId: siteA, name: `${token}-a` },
      { id: locB, siteId: siteA, name: `${token}-b` },
    ]);

    actor = {
      id: randomUUID(),
      name: "Loc Multi Actor",
      email: `t3-loc-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderLocations({
      q: token,
      sort: "siteName:asc,name:desc",
    });

    expect(props.locations.map((l) => l.id)).toEqual([locB, locA]);
  });

  test("page=999 clamps to the last page; pageCount counts filtered rows", async () => {
    actor = {
      id: randomUUID(),
      name: "Loc Sa Actor",
      email: `t3-loc-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const token = `t3-loc-clamp-${randomUUID().slice(0, 8)}`;
    const data = Array.from({ length: 12 }, () => randomUUID());
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, data[0]));
      await db.delete(site).where(eq(site.id, data[0]));
    });
    await db.insert(site).values([{ id: data[0], name: token }]);
    await db.insert(siteLocation).values(
      data.map((id, i) => ({
        id,
        siteId: data[0],
        name: `${token}-${String(i + 1).padStart(2, "0")}`,
      })),
    );

    // Names carry the token (token-01..token-12), so the filtered set is
    // exactly the fixtures.
    const props = await renderLocations({ q: token, page: "999" });
    expect(props.pageCount).toBe(2);
    expect(props.total).toBe(12);
    expect(props.locations.length).toBe(2);
  });

  test("soft-deleted locations do not appear in the table (issue #42)", async () => {
    const token = `t4-loc-del-${randomUUID().slice(0, 8)}`;
    const siteId = randomUUID();
    const deletedLocSiteId = randomUUID();
    const liveId = randomUUID();
    const deletedId = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.id, liveId));
      await db.delete(siteLocation).where(eq(siteLocation.id, deletedId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(site).where(eq(site.id, deletedLocSiteId));
    });
    await db.insert(site).values([
      { id: siteId, name: token },
      { id: deletedLocSiteId, name: `${token}-site-gone` },
    ]);
    await db.insert(siteLocation).values([
      { id: liveId, siteId, name: `${token}-live` },
      { id: deletedId, siteId, name: `${token}-gone` },
    ]);
    await db
      .update(siteLocation)
      .set({ deletedAt: sql`now()` })
      .where(eq(siteLocation.id, deletedId));
    await db
      .update(site)
      .set({ deletedAt: sql`now()` })
      .where(eq(site.id, deletedLocSiteId));

    actor = {
      id: randomUUID(),
      name: "Loc Del Actor",
      email: `t4-loc-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderLocations({ q: token });

    expect(props.locations.map((l) => l.id)).toEqual([liveId]);
    expect(props.total).toBe(1);
    expect(props.pageCount).toBe(1);

    // The site-options list (create dialog) hides soft-deleted sites:
    // shared dev DB, so assert presence/exclusion rather than exact list.
    const optionIds = props.sites.map((s) => s.id);
    expect(optionIds).toContain(siteId);
    expect(optionIds).not.toContain(deletedLocSiteId);
  });
});

// The deleted view (?show=deleted) lists soft-deleted locations inside the
// actor's scope; every other value of show is the live list.
describe("locations page deleted view", () => {
  type DeletedRow = {
    id: string;
    name: string;
    siteName: string;
    isActive: boolean;
    deletedAt: string;
  };

  function actorOf(
    role: SessionUser["role"],
    siteId: string | null = null,
  ): SessionUser {
    return {
      id: randomUUID(),
      name: "Loc Deleted Actor",
      email: `t190-page-${randomUUID()}@shiftly.test`,
      role,
      siteId,
      siteLocationId: null,
      isActive: true,
    };
  }

  async function renderDeleted(
    searchParams: Record<string, string | string[] | undefined> = {},
  ) {
    const props = await renderLocations({ show: "deleted", ...searchParams });
    return { ...props, locations: props.locations as unknown as DeletedRow[] };
  }

  // One site with locations seeded straight into the table so each row can
  // carry its own deletedAt. The site name doubles as the search token.
  async function seedSiteWith(
    rows: Array<{
      suffix: string;
      deletedAt: Date | null;
      isActive?: boolean;
    }>,
  ) {
    const siteId = randomUUID();
    const token = `t190-page-${randomUUID().slice(0, 8)}`;
    fixtureCleanup.defer(async () => {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: token });
    const ids = rows.map(() => randomUUID());
    await db.insert(siteLocation).values(
      rows.map((row, i) => ({
        id: ids[i],
        siteId,
        name: `${token}-${row.suffix}`,
        isActive: row.isActive ?? true,
        deletedAt: row.deletedAt,
      })),
    );
    return { siteId, token, ids };
  }

  test("lists only soft-deleted locations, newest deletion first, with the deleted date", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "older", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "newer", deletedAt: new Date("2026-02-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.locations.map((l) => l.id)).toEqual([ids[2], ids[1]]);
    expect(props.locations[0].deletedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(props.total).toBe(2);
  });

  test("a location of a deleted site is listed too", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "orphan", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    await db
      .update(site)
      .set({ deletedAt: sql`now()` })
      .where(eq(site.id, siteId));
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.locations.map((l) => l.id)).toEqual([ids[0]]);
  });

  test("q narrows within the deleted view", async () => {
    const { token, ids } = await seedSiteWith([
      { suffix: "alpha", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "beta", deletedAt: new Date("2026-01-02T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ q: `${token}-alpha` });

    expect(props.locations.map((l) => l.id)).toEqual([ids[0]]);
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

    expect(inactive.locations.map((l) => l.id)).toEqual([ids[1]]);
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

    expect(props.locations.map((l) => l.id)).toEqual([a.ids[0]]);
    expect(props.locations.map((l) => l.id)).not.toContain(b.ids[0]);
  });

  test("sort=name:asc orders the deleted rows by name; sort=deletedAt:asc by date", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "b", deletedAt: new Date("2026-02-01T10:00:00Z") },
      { suffix: "a", deletedAt: new Date("2026-03-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const byName = await renderDeleted({ siteId, sort: "name:asc" });
    expect(byName.locations.map((l) => l.id)).toEqual([ids[1], ids[0]]);

    const byDate = await renderDeleted({ siteId, sort: "deletedAt:asc" });
    expect(byDate.locations.map((l) => l.id)).toEqual([ids[0], ids[1]]);
  });

  test("locations deleted at the same instant list by ascending id, whatever the insert order", async () => {
    const sameInstant = new Date("2026-01-01T10:00:00Z");
    const { siteId, ids } = await seedSiteWith(
      Array.from({ length: 4 }, (_, i) => ({
        suffix: `s${i}`,
        deletedAt: sameInstant,
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.locations.map((l) => l.id)).toEqual([...ids].sort());
  });

  test("an HO sees only their own site's deleted locations", async () => {
    const own = await seedSiteWith([
      { suffix: "own", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    const foreign = await seedSiteWith([
      { suffix: "foreign", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("ho", own.siteId);

    // A crafted siteId param must not widen the scope.
    const props = await renderDeleted({ siteId: foreign.siteId });

    expect(props.locations.map((l) => l.id)).toEqual([own.ids[0]]);
  });

  test("an HO without a binding sees nothing", async () => {
    actor = actorOf("ho", null);

    const props = await renderDeleted();

    expect(props.locations).toEqual([]);
    expect(props.total).toBe(0);
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
    expect(props.locations).toHaveLength(2);
  });

  test("no show, an unknown show and a repeated show keep listing live locations only", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "gone", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    for (const show of [undefined, "bogus", "DELETED", ["deleted", "deleted"]]) {
      const props = await renderLocations({ siteId, show });
      expect(props.locations.map((l) => l.id)).toEqual([ids[0]]);
    }
  });
});
