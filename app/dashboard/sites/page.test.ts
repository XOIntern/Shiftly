import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { site } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The sites page reads its actor through requireSuperadmin — swapped for a
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

type SiteNode = {
  sites: Array<{ id: string; name: string; isActive: boolean }>;
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the sites travel to the client table
// as the sites/pageCount/total props on <SitesTable>.
function collectSites(node: unknown, out: SiteNode[]): SiteNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectSites(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "sites" in props.props) {
    out.push(props.props as unknown as SiteNode);
  }
  if (props.props) collectSites(props.props.children, out);
  return out;
}

async function renderSites(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<SiteNode> {
  const { default: SitesPage } = await import("./page");
  const tree = await SitesPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectSites(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// t2- prefixed real-DB fixtures: token includes a uuid slice so two suites
// can run concurrently without colliding or matching legacy rows.
describe("sites page server queries (issue #20)", () => {
  test("pagination math travels to the table; page one holds ten rows", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const generated = Array.from({ length: 15 }, () => randomUUID());
    fixtureCleanup.defer(async () => {
      for (const id of generated) {
        await db.delete(site).where(eq(site.id, id));
      }
    });
    await db.insert(site).values(
      generated.map((id, i) => ({
        id,
        name: `${token}-${String(i + 1).padStart(2, "0")}`,
      })),
    );

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites();

    // The shared test DB may hold other rows alongside the fixtures, but
    // count-driven pagination math must hold exactly.
    expect(props.total).toBeGreaterThanOrEqual(15);
    expect(props.pageCount).toBe(
      Math.max(1, Math.ceil(props.total! / 10)),
    );
    expect(props.sites.length).toBe(Math.min(10, props.total!));
  });

  test("q narrows to name matches only, in default name order", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const generated = Array.from(
      { length: 3 },
      (_, i) =>
        ({
          id: randomUUID(),
          name: `${token}-${i === 2 ? "a" : i === 1 ? "b" : "c"}`,
        }) as { id: string; name: string },
    );
    fixtureCleanup.defer(async () => {
      for (const row of generated) {
        await db.delete(site).where(eq(site.id, row.id));
      }
    });
    await db.insert(site).values(generated);

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites({ q: token });

    expect(props.sites.map((row) => row.id)).toEqual([
      generated[2].id,
      generated[1].id,
      generated[0].id,
    ]);
  });

  test("a % in q searches the literal character, not a wildcard", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const withPercent = randomUUID();
    const withoutPercent = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(site).where(eq(site.id, withPercent));
      await db.delete(site).where(eq(site.id, withoutPercent));
    });
    await db.insert(site).values([
      { id: withPercent, name: `${token}-50% off` },
      { id: withoutPercent, name: `${token}-50 off` },
    ]);

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites({ q: "%" });

    expect(props.sites.map((row) => row.id)).toEqual([withPercent]);
  });

  test("status filter keeps only active or inactive rows; junk shows all", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const activeId = randomUUID();
    const inactiveId = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(site).where(eq(site.id, activeId));
      await db.delete(site).where(eq(site.id, inactiveId));
    });
    await db.insert(site).values([
      { id: activeId, name: `${token}-on`, isActive: true },
      { id: inactiveId, name: `${token}-off`, isActive: false },
    ]);

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };

    const all = await renderSites({ q: token });
    expect(all.sites.map((row) => row.id).sort()).toEqual(
      [activeId, inactiveId].sort(),
    );

    const active = await renderSites({ q: token, status: "active" });
    expect(active.sites.map((row) => row.id)).toEqual([activeId]);
    expect(active.total).toBe(1);

    const inactive = await renderSites({ q: token, status: "inactive" });
    expect(inactive.sites.map((row) => row.id)).toEqual([inactiveId]);
    expect(inactive.total).toBe(1);

    // Whitelist: anything else parses to no filter.
    const junk = await renderSites({ q: token, status: "junk" as never });
    expect(junk.sites).toHaveLength(2);
  });

  test("multi-sort orders by the listed keys in priority order", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    // isActive asc puts false first; within each group, name desc reverses.
    const offA = randomUUID();
    const offB = randomUUID();
    const onA = randomUUID();
    const onB = randomUUID();
    fixtureCleanup.defer(async () => {
      for (const row of [offA, offB, onA, onB]) {
        await db.delete(site).where(eq(site.id, row));
      }
    });
    await db.insert(site).values([
      { id: offA, name: `${token}-off-a`, isActive: false },
      { id: offB, name: `${token}-off-b`, isActive: false },
      { id: onA, name: `${token}-on-a`, isActive: true },
      { id: onB, name: `${token}-on-b`, isActive: true },
    ]);

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites({
      q: token,
      sort: "isActive:asc,name:desc",
    });

    expect(props.sites.map((row) => row.id)).toEqual([offB, offA, onB, onA]);
  });

  test("sort=isActive&dir=desc puts active rows first", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const inactiveId = randomUUID();
    const activeId = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(site).where(eq(site.id, inactiveId));
      await db.delete(site).where(eq(site.id, activeId));
    });
    await db.insert(site).values([
      { id: inactiveId, name: `${token}-a`, isActive: false },
      { id: activeId, name: `${token}-b`, isActive: true },
    ]);

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites({
      q: token,
      sort: "isActive",
      dir: "desc",
    });

    expect(props.sites.map((row) => row.id)).toEqual([activeId, inactiveId]);
  });

  test("a bogus sort falls back to the default order", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const generated = [
      { id: randomUUID(), name: `${token}-a` },
      { id: randomUUID(), name: `${token}-z` },
    ];
    fixtureCleanup.defer(async () => {
      for (const row of generated) {
        await db.delete(site).where(eq(site.id, row.id));
      }
    });
    await db.insert(site).values(generated);

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites({
      q: token,
      sort: "bogus" as never,
      dir: "desc" as never,
    });

    expect(props.sites.map((row) => row.id)).toEqual([
      generated[0].id,
      generated[1].id,
    ]);
  });

  test("a crafted prototype-chain sort falls back to the default order", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const generated = [
      { id: randomUUID(), name: `${token}-a` },
      { id: randomUUID(), name: `${token}-z` },
    ];
    fixtureCleanup.defer(async () => {
      for (const row of generated) {
        await db.delete(site).where(eq(site.id, row.id));
      }
    });
    await db.insert(site).values(generated);

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    // The whitelist must be own-property keyed: `Object.prototype` is
    // truthy, so a plain truthiness guard admits these and drizzle
    // throws before any SQL is sent.
    for (const crafted of ["__proto__", "constructor", "valueOf"]) {
      const props = await renderSites({
        q: token,
        sort: crafted as never,
        dir: "asc" as never,
      });
      expect(props.sites.map((row) => row.id)).toEqual([
        generated[0].id,
        generated[1].id,
      ]);
    }
  });

  test("page=999 clamps to the last page of the filtered set", async () => {
    const token = `t2-sites-${randomUUID().slice(0, 8)}`;
    const generated = Array.from({ length: 15 }, () => randomUUID());
    fixtureCleanup.defer(async () => {
      for (const id of generated) {
        await db.delete(site).where(eq(site.id, id));
      }
    });
    await db.insert(site).values(
      generated.map((id, i) => ({
        id,
        name: `${token}-${String(i + 1).padStart(2, "0")}`,
      })),
    );

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t2-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites({ q: token, page: "999" });

    // Only fixture rows match the token; the last page holds the final
    // five names in alphabetical order.
    expect(props.pageCount).toBe(2);
    expect(props.total).toBe(15);
    expect(props.sites.length).toBe(5);
    expect(props.sites.map((row) => row.name.slice(-2))).toEqual([
      "11",
      "12",
      "13",
      "14",
      "15",
    ]);
  });

  test("soft-deleted sites do not appear in the table (issue #40)", async () => {
    const token = `t4-sites-del-${randomUUID().slice(0, 8)}`;
    const liveId = randomUUID();
    const deletedId = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(site).where(eq(site.id, liveId));
      await db.delete(site).where(eq(site.id, deletedId));
    });
    await db.insert(site).values([
      { id: liveId, name: `${token}-live` },
      { id: deletedId, name: `${token}-gone` },
    ]);
    await db.update(site).set({ deletedAt: sql`now()` }).where(eq(site.id, deletedId));

    actor = {
      id: randomUUID(),
      name: "Sites Page Sa",
      email: `t4-sites-page-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSites({ q: token });

    expect(props.sites.map((row) => row.id)).toEqual([liveId]);
    expect(props.total).toBe(1);
  });
});
