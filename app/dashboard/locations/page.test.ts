import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/lib/session";

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
    try {
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
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("a ho's siteId param is ignored — scope keeps its own site's rows", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    try {
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
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("ho actor: search matches name only (address field removed), scoped to its site", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA_name = randomUUID();
    const locB_address = randomUUID();
    const locC_other = randomUUID();
    const locD_foreign = randomUUID();
    try {
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
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA_name));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB_address));
      await db.delete(siteLocation).where(eq(siteLocation.id, locC_other));
      await db.delete(siteLocation).where(eq(siteLocation.id, locD_foreign));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
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
    try {
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
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("sort=siteName orders by the joined site name; bogus falls back", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    try {
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
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("multi-sort: the second key orders within ties of the first", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const token = `t3-loc-multi-${randomUUID().slice(0, 8)}`;
    try {
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
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteA));
      await db.delete(site).where(eq(site.id, siteA));
    }
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
    try {
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
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.siteId, data[0]));
      await db.delete(site).where(eq(site.id, data[0]));
    }
  });
});
