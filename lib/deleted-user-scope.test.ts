import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { and, inArray, isNotNull } from "drizzle-orm";

import { db } from "./db";
import { deletedUserScopeFilter } from "./scope";
import { user } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import { seedLocation, seedSite, seedUser } from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

// The ids of the soft-deleted users the filter lets through, among a known
// set: the shared dev DB holds other suites' rows, so the query is pinned to
// the fixtures' ids.
async function visibleDeleted(
  actor: { role: "superadmin" | "ho" | "admin"; siteId: string | null },
  among: string[],
): Promise<string[]> {
  const scope = deletedUserScopeFilter(actor);
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        isNotNull(user.deletedAt),
        inArray(user.id, among),
        ...(scope ? [scope] : []),
      ),
    );
  return rows.map((row) => row.id).sort();
}

describe("deletedUserScopeFilter (real DB)", () => {
  test("an HO sees exactly the deleted admins of their site's locations, deleted locations included", async () => {
    const siteA = await seedSite(cleanup);
    const siteB = await seedSite(cleanup);
    const liveLoc = await seedLocation(cleanup, siteA.id);
    const deletedLoc = await seedLocation(cleanup, siteA.id, { deleted: true });
    const foreignLoc = await seedLocation(cleanup, siteB.id);

    const adminLive = await seedUser(cleanup, {
      role: "admin",
      siteId: siteA.id,
      siteLocationId: liveLoc.id,
      deleted: true,
    });
    const adminDeletedLoc = await seedUser(cleanup, {
      role: "admin",
      siteId: siteA.id,
      siteLocationId: deletedLoc.id,
      deleted: true,
    });
    const adminForeign = await seedUser(cleanup, {
      role: "admin",
      siteId: siteB.id,
      siteLocationId: foreignLoc.id,
      deleted: true,
    });
    const adminStillLive = await seedUser(cleanup, {
      role: "admin",
      siteId: siteA.id,
      siteLocationId: liveLoc.id,
    });
    const hoOwn = await seedUser(cleanup, {
      role: "ho",
      siteId: siteA.id,
      deleted: true,
    });
    const superadmin = await seedUser(cleanup, {
      role: "superadmin",
      deleted: true,
    });
    const unbound = await seedUser(cleanup, { role: "admin", deleted: true });

    const among = [
      adminLive,
      adminDeletedLoc,
      adminForeign,
      adminStillLive,
      hoOwn,
      superadmin,
      unbound,
    ].map((u) => u.id);

    expect(await visibleDeleted({ role: "ho", siteId: siteA.id }, among)).toEqual(
      [adminLive.id, adminDeletedLoc.id].sort(),
    );
  });

  test("a superadmin is unfiltered", async () => {
    const siteA = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, siteA.id);
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: siteA.id,
      siteLocationId: loc.id,
      deleted: true,
    });
    const ho = await seedUser(cleanup, {
      role: "ho",
      siteId: siteA.id,
      deleted: true,
    });
    const superadmin = await seedUser(cleanup, {
      role: "superadmin",
      deleted: true,
    });

    expect(deletedUserScopeFilter({ role: "superadmin", siteId: null })).toBe(
      undefined,
    );
    expect(
      await visibleDeleted({ role: "superadmin", siteId: null }, [
        admin.id,
        ho.id,
        superadmin.id,
      ]),
    ).toEqual([admin.id, ho.id, superadmin.id].sort());
  });

  test("an HO bound to no site sees nothing", async () => {
    const siteA = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, siteA.id);
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: siteA.id,
      siteLocationId: loc.id,
      deleted: true,
    });

    expect(await visibleDeleted({ role: "ho", siteId: null }, [admin.id])).toEqual(
      [],
    );
  });

  test("an admin actor sees nothing", async () => {
    const siteA = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, siteA.id);
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: siteA.id,
      siteLocationId: loc.id,
      deleted: true,
    });

    expect(
      await visibleDeleted({ role: "admin", siteId: siteA.id }, [admin.id]),
    ).toEqual([]);
  });
});
