import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { locationMutationWhere, locationOwnedByActor } from "./location-scope";
import { deleteSiteGuarded } from "./site-delete";
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

// Issue #17 Task 2: the ownership predicate must ride INSIDE the mutating
// statement's WHERE (the weld) so the check-then-write (TOCTOU) window is
// closed for good. The seam still stands — locationOwnedByActor keeps
// running first for its friendly message and clean test seam — but even a
// write that reaches the DB with only a raw id cannot touch a foreign row.
//
// Seam: these are the exact statements each action performs (update with
// re-parent, toggle with `not isActive`, delete), executed through
// locationMutationWhere — the helper the actions all delegate to — because
// the server actions themselves need a live request via requireHO().
describe("ho ownership weld in the mutating WHERE (issue #17 Task 2)", () => {
  test("foreign-site ho: welded update/toggle/delete probes touch nothing; the row stays put", async () => {
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const locationId = randomUUID();
    const hoId = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteAId, name: `weld-site-a-${siteAId}` },
        { id: siteBId, name: `weld-site-b-${siteBId}` },
      ]);
      await db.insert(siteLocation).values({
        id: locationId,
        siteId: siteBId,
        name: "Foreign Warehouse",
      });
      await db.insert(user).values({
        id: hoId,
        name: "Weld HO",
        email: `weld-${hoId}@shiftly.test`,
        emailVerified: true,
        role: "ho",
        siteId: siteAId,
      });
      const [ho] = await db.select().from(user).where(eq(user.id, hoId));

      // Seam unchanged: the pre-check still denies foreign rows.
      expect(await locationOwnedByActor(ho, locationId)).toBe(false);

      // The weld: one transaction playing the actions' writes exactly —
      // re-parenting update, isActive toggle, delete — all through the
      // welded WHERE.
      const probe = await db.transaction(async (tx) => {
        const reParented = await tx
          .update(siteLocation)
          .set({ name: "Hijacked", siteId: siteAId })
          .where(locationMutationWhere(ho, locationId))
          .returning({ id: siteLocation.id });
        const toggled = await tx
          .update(siteLocation)
          .set({ isActive: sql`not ${siteLocation.isActive}` })
          .where(locationMutationWhere(ho, locationId))
          .returning({ id: siteLocation.id });
        const deleted = await tx
          .delete(siteLocation)
          .where(locationMutationWhere(ho, locationId))
          .returning({ id: siteLocation.id });
        return { reParented, toggled, deleted };
      });

      expect(probe.reParented).toHaveLength(0);
      expect(probe.toggled).toHaveLength(0);
      expect(probe.deleted).toHaveLength(0);

      // Site B's location: not deleted, not toggled, not re-parented.
      const [row] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(row).toBeTruthy();
      expect(row.siteId).toBe(siteBId);
      expect(row.name).toBe("Foreign Warehouse");
      expect(row.isActive).toBe(true);
    } finally {
      await db.delete(user).where(eq(user.id, hoId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    }
  });

  test("unbound ho: the welded WHERE fails closed even against an existing row", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `weld-unbound-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Unbound Ho Target",
      });
      const toggled = await db
        .update(siteLocation)
        .set({ isActive: sql`not ${siteLocation.isActive}` })
        .where(locationMutationWhere({ role: "ho", siteId: null }, locationId))
        .returning({ id: siteLocation.id });
      expect(toggled).toHaveLength(0);
      const [row] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(row.isActive).toBe(true);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: the weld lets an ho toggle/delete under their own site", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `weld-own-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Own Weld Warehouse",
      });
      const ho = { role: "ho" as const, siteId };

      const probe = await db.transaction(async (tx) => {
        const toggled = await tx
          .update(siteLocation)
          .set({ isActive: sql`not ${siteLocation.isActive}` })
          .where(locationMutationWhere(ho, locationId))
          .returning({ isActive: siteLocation.isActive });
        const deleted = await tx
          .delete(siteLocation)
          .where(locationMutationWhere(ho, locationId))
          .returning({ id: siteLocation.id });
        return { toggled, deleted };
      });

      expect(probe.toggled).toEqual([{ isActive: false }]);
      expect(probe.deleted).toHaveLength(1);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: superadmin's welded WHERE stays eq(id)-only", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `weld-sa-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Superadmin Weld Target",
      });
      // superadmin is unbound and unscoped — eq(id) matches regardless of
      // any site predicate; the actions' own zero-row handling covers
      // nonexistent ids.
      const toggled = await db
        .update(siteLocation)
        .set({ isActive: sql`not ${siteLocation.isActive}` })
        .where(
          locationMutationWhere({ role: "superadmin", siteId: null }, locationId),
        )
        .returning({ id: siteLocation.id });
      expect(toggled).toHaveLength(1);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});

// Issue #17 Task 2: deleteSite must run its three relation guards and the
// DELETE inside ONE transaction, so a site can never lose rows while a
// guard race is mid-flight (no partial writes). deleteSiteGuarded is the
// exported testable helper mirroring the locationOwnedByActor seam — the
// action delegates to it within db.transaction.
describe("deleteSite transactional guards (issue #17 Task 2)", () => {
  test("(a) site with a location is refused; the location row stays intact", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({
        id: siteId,
        name: `del-site-a-${siteId}`,
        isActive: false,
      });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Blocking Location",
      });

      const result = await db.transaction((tx) =>
        deleteSiteGuarded(tx, siteId),
      );
      expect(result).toEqual({
        ok: false,
        message: "Locations still exist under this site",
      });

      // No partial writes: both rows survive.
      const [loc] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(loc).toBeTruthy();
      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow).toBeTruthy();
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("(b) user bound directly to the site", async () => {
    const siteId = randomUUID();
    const userId = randomUUID();

    try {
      await db.insert(site).values({
        id: siteId,
        name: `del-site-b-${siteId}`,
        isActive: false,
      });
      await db.insert(user).values({
        id: userId,
        name: "Site Bound Ho",
        email: `del-site-b-${userId}@shiftly.test`,
        emailVerified: true,
        role: "ho",
        siteId,
      });

      const result = await db.transaction((tx) =>
        deleteSiteGuarded(tx, siteId),
      );
      expect(result).toEqual({
        ok: false,
        message: "Users are still bound to this site",
      });
      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow).toBeTruthy();
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("user bound via a location under the site: the locations guard answers first", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();

    try {
      await db.insert(site).values({
        id: siteId,
        name: `del-site-c-${siteId}`,
        isActive: false,
      });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Occupied Location",
      });
      await db.insert(user).values({
        id: userId,
        name: "Location Bound Admin",
        email: `del-site-c-${userId}@shiftly.test`,
        emailVerified: true,
        role: "admin",
        siteLocationId: locationId,
      });

      // Guard order (a) before (c) means a user bound through a location
      // under the site is answered by the locations guard — the joined
      // (c) query stays as the belt-and-braces backstop the issue pins.
      const result = await db.transaction((tx) =>
        deleteSiteGuarded(tx, siteId),
      );
      expect(result).toEqual({
        ok: false,
        message: "Locations still exist under this site",
      });
      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow).toBeTruthy();
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: an empty inactive site deletes in one transaction", async () => {
    const siteId = randomUUID();

    try {
      await db.insert(site).values({
        id: siteId,
        name: `del-site-ok-${siteId}`,
        isActive: false,
      });

      const result = await db.transaction((tx) =>
        deleteSiteGuarded(tx, siteId),
      );
      expect(result).toEqual({ ok: true });

      // Soft-delete epic #39: the write is now an UPDATE setting deleted_at,
      // so the row survives with a non-null deletedAt instead of vanishing.
      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow).toBeTruthy();
      expect(siteRow.deletedAt).not.toBeNull();
    } finally {
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: an empty ACTIVE site is refused — deactivate first (issue #46 guard 0)", async () => {
    const siteId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `del-site-active-${siteId}` });

      const result = await db.transaction((tx) =>
        deleteSiteGuarded(tx, siteId),
      );
      expect(result).toEqual({
        ok: false,
        message: "Deactivate the site before deleting it",
      });

      // The row stays live: not archived, no deletedAt set.
      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow).toBeTruthy();
      expect(siteRow.deletedAt).toBeNull();
    } finally {
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("a nonexistent site id answers 'Site not found.' instead of silently passing (issue #46)", async () => {
    const result = await db.transaction((tx) =>
      deleteSiteGuarded(tx, randomUUID()),
    );
    expect(result).toEqual({ ok: false, message: "Site not found." });
  });
});
