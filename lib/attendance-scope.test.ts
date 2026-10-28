import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { siteLocation } from "../drizzle/schema";
import { db } from "./db";
import { installCleanup } from "./test-cleanup";
import { seedLocation, seedSite } from "./test-fixtures";
import {
  attendanceLocationWhere,
  writableLocationId,
} from "./attendance-scope";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

type Actor = Parameters<typeof writableLocationId>[0];

const actor = (overrides: Partial<Actor>): Actor => ({
  role: "admin",
  siteId: null,
  siteLocationId: null,
  ...overrides,
});

describe("writableLocationId", () => {
  test("an admin writes to their own location", () => {
    expect(
      writableLocationId(actor({ role: "admin", siteLocationId: "loc-1" })),
    ).toBe("loc-1");
  });

  test("an admin without a location binding writes nowhere", () => {
    expect(writableLocationId(actor({ role: "admin" }))).toBeNull();
  });

  test("an ho never writes, whatever their binding", () => {
    expect(
      writableLocationId(
        actor({ role: "ho", siteId: "site-1", siteLocationId: "loc-1" }),
      ),
    ).toBeNull();
  });

  test("a superadmin never writes", () => {
    expect(writableLocationId(actor({ role: "superadmin" }))).toBeNull();
  });
});

// The same three-way shape as the roster page's location picker: which
// locations the actor may open, live ones only. Run against real rows so the
// predicate itself is what is tested, not its text.
describe("attendanceLocationWhere", () => {
  async function seedTwoSites() {
    const siteA = await seedSite(cleanup);
    const siteB = await seedSite(cleanup);
    const a1 = await seedLocation(cleanup, siteA.id);
    const a2 = await seedLocation(cleanup, siteA.id);
    const aGone = await seedLocation(cleanup, siteA.id, { deleted: true });
    const b1 = await seedLocation(cleanup, siteB.id);
    return { siteA, siteB, a1, a2, aGone, b1 };
  }

  async function visibleAmong(
    candidates: string[],
    who: Actor,
  ): Promise<string[]> {
    const rows = await db
      .select({ id: siteLocation.id })
      .from(siteLocation)
      .where(attendanceLocationWhere(who));
    const visible = new Set(rows.map((row) => row.id));
    return candidates.filter((id) => visible.has(id)).sort();
  }

  test("an admin sees only their own location", async () => {
    const f = await seedTwoSites();
    const all = [f.a1.id, f.a2.id, f.aGone.id, f.b1.id];

    expect(
      await visibleAmong(
        all,
        actor({ role: "admin", siteId: f.siteA.id, siteLocationId: f.a1.id }),
      ),
    ).toEqual([f.a1.id]);
  });

  test("an admin pinned to a deleted location sees nothing", async () => {
    const f = await seedTwoSites();

    expect(
      await visibleAmong(
        [f.a1.id, f.aGone.id],
        actor({ role: "admin", siteId: f.siteA.id, siteLocationId: f.aGone.id }),
      ),
    ).toEqual([]);
  });

  test("an admin without a binding sees nothing", async () => {
    const f = await seedTwoSites();

    expect(
      await visibleAmong([f.a1.id, f.b1.id], actor({ role: "admin" })),
    ).toEqual([]);
  });

  test("an ho sees the live locations of their own site only", async () => {
    const f = await seedTwoSites();
    const all = [f.a1.id, f.a2.id, f.aGone.id, f.b1.id];

    expect(
      await visibleAmong(all, actor({ role: "ho", siteId: f.siteA.id })),
    ).toEqual([f.a1.id, f.a2.id].sort());
  });

  test("an ho without a site sees nothing", async () => {
    const f = await seedTwoSites();

    expect(
      await visibleAmong([f.a1.id, f.b1.id], actor({ role: "ho" })),
    ).toEqual([]);
  });

  test("a superadmin sees every live location, never a deleted one", async () => {
    const f = await seedTwoSites();
    const all = [f.a1.id, f.a2.id, f.aGone.id, f.b1.id];

    expect(await visibleAmong(all, actor({ role: "superadmin" }))).toEqual(
      [f.a1.id, f.a2.id, f.b1.id].sort(),
    );
  });
});
