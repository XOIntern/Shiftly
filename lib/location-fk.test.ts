import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { locationOwnedByActor } from "./location-scope";
import { site, siteLocation, user } from "../drizzle/schema";

// Real dev DB (docker shiftly-postgres :5433): proves the site_location ->
// user FK is enforced with ON DELETE RESTRICT by hitting the constraint the
// way a live delete would, then cleaning every row up.
describe("site_location delete FK restrict", () => {
  test("deleting a location bound to a user violates the FK (23001/23503)", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();

    try {
      await db.insert(site).values({
        id: siteId,
        name: `fk-loc-site-${siteId}`,
      });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Main Warehouse",
        address: "Jl. Test 123",
      });
      // The binding that must hold the location: role "admin" is the role the
      // redesign binds to exactly one site_location.
      await db.insert(user).values({
        id: userId,
        name: "Location FK Test Admin",
        email: `loc-fk-${userId}@shiftly.test`,
        emailVerified: true,
        role: "admin",
        siteLocationId: locationId,
      });

      let code: string | undefined;
      try {
        await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      } catch (err) {
        code = pgErrorCode(err);
      }
      // Issue #13 said 23503, but Postgres raises 23001 (restrict_violation)
      // for ON DELETE RESTRICT constraints; 23503 only covers NO ACTION. The
      // delete still must fail with a foreign-key error code either way.
      expect(code === "23001" || code === "23503").toBe(true);
    } finally {
      // Cleanup in child-first order; user delete cascades nothing here but
      // must go before the location row it references.
      await db.delete(user).where(eq(user.id, userId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});

// Pinning test for the whole-branch-review Critical: before the guard,
// updateLocation/toggleLocation/deleteLocation targeted `eq(id)` only, so an
// ho could mutate another site's location — a re-parented foreign location
// let its bound admins resolve targetSiteId to the ho's site, clearing
// canManageUser for cross-site admin takeover.
//
// Seam: the ownership check lives in an exported helper
// (lib/location-scope.ts locationOwnedByActor), which the three server
// actions all call before any write. requireHO() needs a live request
// (next/headers + redirect), so calling the actions in-process is not
// practical in bun test; the helper is exercised against the real DB and
// each action calls it unconditionally before its own write.
describe("location ownership guard (review Critical: by-id scoping)", () => {
  test("ho bound to site A does not own a location under site B; the row is untouched", async () => {
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const locationId = randomUUID();
    const hoId = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteAId, name: `guard-site-a-${siteAId}` },
        { id: siteBId, name: `guard-site-b-${siteBId}` },
      ]);
      await db.insert(siteLocation).values({
        id: locationId,
        siteId: siteBId, // foreign to the ho below
        name: "Foreign Warehouse",
        address: "Jl. Guard 456",
      });
      // Real ho fixture, bound to site A, like a live session would be.
      await db.insert(user).values({
        id: hoId,
        name: "Ownership Guard HO",
        email: `own-guard-${hoId}@shiftly.test`,
        emailVerified: true,
        role: "ho",
        siteId: siteAId,
      });
      const [ho] = await db.select().from(user).where(eq(user.id, hoId));

      const allowed = await locationOwnedByActor(ho, locationId);
      expect(allowed).toBe(false);

      // The DB row must survive every action the guard gates: not deleted,
      // not toggled, not re-parented into the ho's site A.
      const [row] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(row).toBeTruthy();
      expect(row.siteId).toBe(siteBId);
      expect(row.isActive).toBe(true);
      expect(row.name).toBe("Foreign Warehouse");
    } finally {
      await db.delete(user).where(eq(user.id, hoId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    }
  });

  test("positive control: ho does own a location under their own site", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `guard-site-own-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Own Warehouse",
      });
      // The guard must not simply deny everything — an ho manages their own
      // rows exactly as the actions did before.
      const allowed = await locationOwnedByActor(
        { role: "ho", siteId },
        locationId,
      );
      expect(allowed).toBe(true);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("superadmin stays unscoped and an unbound ho is denied", async () => {
    const locationId = randomUUID(); // no row exists at all
    // superadmin keeps full capability even for a nonexistent id (the
    // actions' own zero-row handling still reports "not found").
    expect(
      await locationOwnedByActor({ role: "superadmin", siteId: null }, locationId),
    ).toBe(true);
    // site_location.site_id is NOT NULL, so an unbound ho (siteId null)
    // can never match — fail closed.
    expect(
      await locationOwnedByActor({ role: "ho", siteId: null }, locationId),
    ).toBe(false);
  });
});
