import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { installCleanup } from "../test-cleanup";
import { seedLocation, seedSite } from "../test-fixtures";
import { loadScopedLocations } from "./locations";

const cleanup = installCleanup();

type Actor = Parameters<typeof loadScopedLocations>[0];

const actor = (overrides: Partial<Actor>): Actor => ({
  role: "admin",
  siteId: null,
  siteLocationId: null,
  ...overrides,
});

// Site names sort A before B, location names Alpha before Zulu.
async function seedTwoSites() {
  const siteA = await seedSite(cleanup, { name: `t-dl-a-${randomUUID()}` });
  const siteB = await seedSite(cleanup, { name: `t-dl-b-${randomUUID()}` });
  const a1 = await seedLocation(cleanup, siteA.id, {
    name: "Zulu",
    timezone: "Asia/Jayapura",
  });
  const a2 = await seedLocation(cleanup, siteA.id, { name: "Alpha" });
  const aGone = await seedLocation(cleanup, siteA.id, { deleted: true });
  const b1 = await seedLocation(cleanup, siteB.id, {
    timezone: "Asia/Makassar",
  });
  return { siteA, siteB, a1, a2, aGone, b1 };
}

// Other tests' rows share the database, so only the fixtures are compared.
async function idsFor(who: Actor, candidates: string[]): Promise<string[]> {
  const rows = await loadScopedLocations(who);
  return rows.map((row) => row.id).filter((id) => candidates.includes(id));
}

describe("loadScopedLocations", () => {
  test("a superadmin gets every live location of both sites", async () => {
    const f = await seedTwoSites();
    const all = [f.a1.id, f.a2.id, f.aGone.id, f.b1.id];

    const ids = await idsFor(actor({ role: "superadmin" }), all);

    expect(ids.sort()).toEqual([f.a1.id, f.a2.id, f.b1.id].sort());
  });

  test("an ho gets only their own site's locations", async () => {
    const f = await seedTwoSites();
    const all = [f.a1.id, f.a2.id, f.aGone.id, f.b1.id];

    const ids = await idsFor(actor({ role: "ho", siteId: f.siteA.id }), all);

    expect(ids.sort()).toEqual([f.a1.id, f.a2.id].sort());
  });

  test("an admin gets only their own location", async () => {
    const f = await seedTwoSites();
    const all = [f.a1.id, f.a2.id, f.aGone.id, f.b1.id];

    const ids = await idsFor(
      actor({ role: "admin", siteId: f.siteA.id, siteLocationId: f.a2.id }),
      all,
    );

    expect(ids).toEqual([f.a2.id]);
  });

  test("an unbound admin and an unbound ho get nothing", async () => {
    await seedTwoSites();

    expect(await loadScopedLocations(actor({ role: "admin" }))).toEqual([]);
    expect(await loadScopedLocations(actor({ role: "ho" }))).toEqual([]);
  });

  test("a soft-deleted location is absent even for its own admin", async () => {
    const f = await seedTwoSites();

    expect(
      await loadScopedLocations(
        actor({ role: "admin", siteLocationId: f.aGone.id }),
      ),
    ).toEqual([]);
  });

  test("siteName and timezone are filled, ordered by location name within a site", async () => {
    const f = await seedTwoSites();

    const rows = await loadScopedLocations(
      actor({ role: "ho", siteId: f.siteA.id }),
    );

    expect(rows).toEqual([
      {
        id: f.a2.id,
        siteId: f.siteA.id,
        siteName: f.siteA.name,
        name: "Alpha",
        timezone: "Asia/Jakarta",
      },
      {
        id: f.a1.id,
        siteId: f.siteA.id,
        siteName: f.siteA.name,
        name: "Zulu",
        timezone: "Asia/Jayapura",
      },
    ]);
  });

  test("a superadmin's list is ordered by site name first", async () => {
    const f = await seedTwoSites();

    const ids = await idsFor(actor({ role: "superadmin" }), [
      f.a1.id,
      f.a2.id,
      f.b1.id,
    ]);

    expect(ids).toEqual([f.a2.id, f.a1.id, f.b1.id]);
  });
});
