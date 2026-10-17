import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { deleteSiteGuarded } from "./site-delete";
import { userScopeFilter } from "./scope";
import { site, siteLocation, user } from "../drizzle/schema";
import type { SessionUser } from "./session";

// Task 1 of the soft-delete epic (GitHub #37): site, site_location and user
// gain a nullable deleted_at and their unique constraints become partial
// unique indexes (WHERE deleted_at IS NULL). These tests run against the real
// dev DB (docker shiftly-postgres :5433) and pin the actual constraint
// behaviour: a soft-deleted row frees its name/email for reuse, while a live
// duplicate is still refused with 23505.
describe("soft delete partial unique indexes (issue #37 task 1)", () => {
  test("site: soft-deleted name is reusable; live duplicate still refused (23505)", async () => {
    const originalId = randomUUID();
    const replacementId = randomUUID();
    const name = `soft-del-site-${randomUUID()}`;

    try {
      await db.insert(site).values({ id: originalId, name });

      // Live duplicate is still refused by the partial index.
      let code: string | undefined;
      try {
        await db.insert(site).values({ id: replacementId, name });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");

      // Soft-delete the original: its name leaves the index.
      await db
        .update(site)
        .set({ deletedAt: sql`now()` })
        .where(eq(site.id, originalId));

      // The name can now be reused by a new live row.
      const reused = await db
        .insert(site)
        .values({ id: replacementId, name })
        .returning({ id: site.id });
      expect(reused).toEqual([{ id: replacementId }]);

      // ...but two live rows with the same name remain impossible.
      const thirdId = randomUUID();
      code = undefined;
      try {
        await db.insert(site).values({ id: thirdId, name });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");
    } finally {
      await db.delete(site).where(eq(site.id, replacementId));
      await db.delete(site).where(eq(site.id, originalId));
    }
  });

  test("site_location: soft-deleted (site_id, name) pair is reusable; live duplicate still refused (23505)", async () => {
    const siteId = randomUUID();
    const originalId = randomUUID();
    const replacementId = randomUUID();
    const name = `soft-del-loc-${randomUUID()}`;

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-loc-site-${siteId}` });
      await db.insert(siteLocation).values({
        id: originalId,
        siteId,
        name,
      });

      // Live duplicate of the (site_id, name) pair is refused.
      let code: string | undefined;
      try {
        await db.insert(siteLocation).values({
          id: replacementId,
          siteId,
          name,
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");

      // Soft-delete the original: the pair frees up.
      await db
        .update(siteLocation)
        .set({ deletedAt: sql`now()` })
        .where(eq(siteLocation.id, originalId));

      const reused = await db
        .insert(siteLocation)
        .values({ id: replacementId, siteId, name })
        .returning({ id: siteLocation.id });
      expect(reused).toEqual([{ id: replacementId }]);

      // A third live row with the same pair is still refused.
      const thirdId = randomUUID();
      code = undefined;
      try {
        await db.insert(siteLocation).values({ id: thirdId, siteId, name });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, replacementId));
      await db.delete(siteLocation).where(eq(siteLocation.id, originalId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("user: soft-deleted email is reusable; live duplicate still refused (23505)", async () => {
    const originalId = randomUUID();
    const replacementId = randomUUID();
    const email = `soft-del-${randomUUID()}@shiftly.test`;

    try {
      await db.insert(user).values({
        id: originalId,
        name: "Soft Delete Original",
        email,
        emailVerified: true,
        role: "ho",
      });

      // Live duplicate email is refused.
      let code: string | undefined;
      try {
        await db.insert(user).values({
          id: replacementId,
          name: "Soft Delete Duplicate",
          email,
          emailVerified: true,
          role: "ho",
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");

      // Soft-delete the original: the email frees up.
      await db
        .update(user)
        .set({ deletedAt: sql`now()` })
        .where(eq(user.id, originalId));

      const reused = await db
        .insert(user)
        .values({
          id: replacementId,
          name: "Soft Delete Replacement",
          email,
          emailVerified: true,
          role: "ho",
        })
        .returning({ id: user.id });
      expect(reused).toEqual([{ id: replacementId }]);

      // A third live row with the same email is still refused.
      const thirdId = randomUUID();
      code = undefined;
      try {
        await db.insert(user).values({
          id: thirdId,
          name: "Soft Delete Third",
          email,
          emailVerified: true,
          role: "ho",
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");
    } finally {
      await db.delete(user).where(eq(user.id, replacementId));
      await db.delete(user).where(eq(user.id, originalId));
    }
  });

  test("deletedAt is nullable and null by default on all three tables", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-null-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Null DeletedAt Location",
      });
      await db.insert(user).values({
        id: userId,
        name: "Null DeletedAt User",
        email: `soft-del-null-${userId}@shiftly.test`,
        emailVerified: true,
        role: "ho",
        siteId,
      });

      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow.deletedAt).toBeNull();
      const [locRow] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(locRow.deletedAt).toBeNull();
      const [userRow] = await db.select().from(user).where(eq(user.id, userId));
      expect(userRow.deletedAt).toBeNull();

      // The live-scope predicate later tasks will rely on.
      const liveSites = await db
        .select({ id: site.id })
        .from(site)
        .where(and(eq(site.id, siteId), isNull(site.deletedAt)));
      expect(liveSites).toEqual([{ id: siteId }]);
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});

// Task 3 of the soft-delete epic (GitHub #39): deleteSiteGuarded's guards
// consider only LIVE rows, and the final write soft-deletes instead of a
// hard DELETE. Pinned issue #17 messages are reused verbatim.
describe("deleteSiteGuarded ignores deleted rows (issue #39 task 3)", () => {
  test("soft-deleted location does not block; the site row survives soft-deleted", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-guard-a-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Soft Deleted Location",
      });

      // Before soft-deleting, the same location still blocks the delete.
      const before = await db.transaction((tx) =>
        deleteSiteGuarded(tx, siteId),
      );
      expect(before).toEqual({
        ok: false,
        message: "Locations still exist under this site",
      });

      await db
        .update(siteLocation)
        .set({ deletedAt: sql`now()` })
        .where(eq(siteLocation.id, locationId));

      // The soft-deleted location no longer blocks.
      const result = await db.transaction((tx) => deleteSiteGuarded(tx, siteId));
      expect(result).toEqual({ ok: true });

      // The site row survives as a soft delete, not a hard one.
      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow).toBeTruthy();
      expect(siteRow.deletedAt).not.toBeNull();
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("soft-deleted directly-bound user does not block deleting the site", async () => {
    const siteId = randomUUID();
    const deletedUserId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-guard-b-${siteId}` });
      await db.insert(user).values({
        id: deletedUserId,
        name: "Soft Deleted Bound Ho",
        email: `soft-del-guard-b-${deletedUserId}@shiftly.test`,
        emailVerified: true,
        role: "ho",
        siteId,
      });
      await db.update(user).set({ deletedAt: sql`now()` }).where(eq(user.id, deletedUserId));

      const result = await db.transaction((tx) => deleteSiteGuarded(tx, siteId));
      expect(result).toEqual({ ok: true });

      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow.deletedAt).not.toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, deletedUserId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("live location still blocks with the pinned message", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-guard-live-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Still Live Location",
      });

      const result = await db.transaction((tx) => deleteSiteGuarded(tx, siteId));
      expect(result).toEqual({
        ok: false,
        message: "Locations still exist under this site",
      });
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});

// The location delete actions resolve their actor through requireHO —
// swapped for a stub (same pattern as app/dashboard/users/page.test.ts) so
// the real server actions run against the test database without a Next
// request context. The mock swaps the WHOLE module across bun's single test
// process, so every export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test — revalidation is a no-op stub.
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

function hoActorFor(siteId: string): SessionUser {
  return {
    id: randomUUID(),
    name: "Soft Del HO",
    email: `soft-del-loc-${randomUUID()}@shiftly.test`,
    role: "ho",
    siteId,
    siteLocationId: null,
    isActive: true,
  };
}

// Task 5 of the soft-delete epic (GitHub #41): deleteLocation/deleteBulk
// soft-delete (deleted_at) instead of a hard DELETE, their bound-user guards
// ignore soft-deleted users, and the ownership welds never match a deleted
// row — so a deleted location answers "Location not found." everywhere.
describe("location delete actions soft-delete (issue #41 task 5)", () => {
  test("deleteLocation soft-deletes instead of removing the row", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-act-a-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Soft Delete Me",
      });
      actor = hoActorFor(siteId);

      const { deleteLocation } = await import(
        "../app/dashboard/locations/actions"
      );
      const result = await deleteLocation(locationId);
      expect(result).toEqual({ ok: true });

      // The row survives as a soft delete, not a hard one.
      const [row] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(row).toBeTruthy();
      expect(row.deletedAt).not.toBeNull();
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("a location with only soft-deleted bound users is deletable", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const deletedAdminId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-act-b-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Only Deleted Admin",
      });
      await db.insert(user).values({
        id: deletedAdminId,
        name: "Soft Deleted Admin",
        email: `soft-del-act-${deletedAdminId}@shiftly.test`,
        emailVerified: true,
        role: "admin",
        siteLocationId: locationId,
      });
      await db
        .update(user)
        .set({ deletedAt: sql`now()` })
        .where(eq(user.id, deletedAdminId));
      actor = hoActorFor(siteId);

      const { deleteLocation } = await import(
        "../app/dashboard/locations/actions"
      );
      const result = await deleteLocation(locationId);
      expect(result).toEqual({ ok: true });

      const [row] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(row.deletedAt).not.toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, deletedAdminId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("a location with a live bound user still refuses (pinned message)", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const liveAdminId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-act-c-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Live Admin Bound",
      });
      await db.insert(user).values({
        id: liveAdminId,
        name: "Live Admin",
        email: `soft-del-act-${liveAdminId}@shiftly.test`,
        emailVerified: true,
        role: "admin",
        siteLocationId: locationId,
      });
      actor = hoActorFor(siteId);

      const { deleteLocation } = await import(
        "../app/dashboard/locations/actions"
      );
      const result = await deleteLocation(locationId);
      expect(result).toEqual({
        ok: false,
        message: "Users are still bound to this location",
      });

      // The refusal writes nothing: the location stays live.
      const [row] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(row.deletedAt).toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, liveAdminId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("an already-deleted location answers 'Location not found.'", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-act-d-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Already Gone",
        deletedAt: sql`now()`,
      });
      actor = hoActorFor(siteId);

      const { deleteLocation } = await import(
        "../app/dashboard/locations/actions"
      );
      const result = await deleteLocation(locationId);
      expect(result).toEqual({ ok: false, message: "Location not found." });
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("deleteBulk: deleted-location-with-bound-user is neither applied nor blocked; live-bound blocks; free applies", async () => {
    const siteId = randomUUID();
    const free = randomUUID();
    const liveBound = randomUUID();
    const deletedBound = randomUUID();
    const liveAdminId = randomUUID();
    const stuckAdminId = randomUUID();

    try {
      await db.insert(site).values([{ id: siteId, name: `soft-del-act-e-${siteId}` }]);
      await db.insert(siteLocation).values([
        { id: free, siteId, name: "Bulk Free" },
        { id: liveBound, siteId, name: "Bulk Live Bound" },
        // Soft-deleted earlier, its admin binding left behind: the bulk
        // write must not resurrect it, and it must not count as blocked.
        { id: deletedBound, siteId, name: "Bulk Already Deleted", deletedAt: sql`now()` },
      ]);
      await db.insert(user).values([
        {
          id: liveAdminId,
          name: "Bulk Live Admin",
          email: `soft-del-act-${liveAdminId}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: liveBound,
        },
        {
          id: stuckAdminId,
          name: "Bulk Stuck Admin",
          email: `soft-del-act-${stuckAdminId}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: deletedBound,
        },
      ]);
      actor = hoActorFor(siteId);

      const { deleteBulk } = await import(
        "../app/dashboard/locations/actions"
      );
      const result = await deleteBulk([free, liveBound, deletedBound]);

      // "Do what you can": the free row applies, the live-bound one is
      // skipped with the pinned guard message, and the already-deleted row
      // is invisible to both counts.
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.message).toContain(
        "Users are still bound to this location",
      );

      // Free: soft-deleted, not removed. Live-bound: untouched. The
      // already-deleted row: still deleted, never re-touched.
      const rows = await db
        .select({ id: siteLocation.id, deletedAt: siteLocation.deletedAt })
        .from(siteLocation)
        .where(inArray(siteLocation.id, [free, liveBound, deletedBound]));
      const deletedAtOf = (id: string) =>
        rows.find((row) => row.id === id)?.deletedAt;
      expect(deletedAtOf(free)).not.toBeNull();
      expect(deletedAtOf(liveBound)).toBeNull();
      expect(deletedAtOf(deletedBound)).not.toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, liveAdminId));
      await db.delete(user).where(eq(user.id, stuckAdminId));
      await db
        .delete(siteLocation)
        .where(inArray(siteLocation.id, [free, liveBound, deletedBound]));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});

// Task 6 of the soft-delete epic (GitHub #42): userScopeFilter must exclude
// soft-deleted users on both branches (site-bound and location-bound) and
// admins bound to a soft-deleted location. The returned SQL is executed
// against the real DB, per the plan.
describe("userScopeFilter excludes soft-deleted rows (issue #42 task 6)", () => {
  test("ho filter drops a soft-deleted site-bound admin and a deleted location's admin", async () => {
    const siteId = randomUUID();
    const liveLocId = randomUUID();
    const deletedLocId = randomUUID();
    const liveAdminId = randomUUID();
    const deletedAdminId = randomUUID();
    const deadLocAdminId = randomUUID();

    try {
      await db.insert(site).values([{ id: siteId, name: `scope-del-site-${siteId}` }]);
      await db.insert(siteLocation).values([
        { id: liveLocId, siteId, name: "Scope Del Live Loc" },
        { id: deletedLocId, siteId, name: "Scope Del Dead Loc", deletedAt: sql`now()` },
      ]);
      await db.insert(user).values([
        {
          id: liveAdminId,
          name: "Scope Del Live Admin",
          email: `scope-del-${liveAdminId}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteId,
          siteLocationId: liveLocId,
        },
        {
          id: deletedAdminId,
          name: "Scope Del Deleted Admin",
          email: `scope-del-${deletedAdminId}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteId,
          siteLocationId: liveLocId,
        },
        {
          id: deadLocAdminId,
          name: "Scope Del Dead Loc Admin",
          email: `scope-del-${deadLocAdminId}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: deletedLocId,
        },
      ]);
      await db
        .update(user)
        .set({ deletedAt: sql`now()` })
        .where(eq(user.id, deletedAdminId));

      const filter = userScopeFilter({ role: "ho", siteId });
      const visible = await db
        .select({ id: user.id })
        .from(user)
        .where(filter);
      // Only the live admin of the live location survives: the soft-deleted
      // admin drops on the and-wrapped user branch, the dead-location admin
      // on the subquery branch.
      expect(visible.map((r) => r.id)).toEqual([liveAdminId]);
    } finally {
      await db.delete(user).where(eq(user.id, liveAdminId));
      await db.delete(user).where(eq(user.id, deletedAdminId));
      await db.delete(user).where(eq(user.id, deadLocAdminId));
      await db.delete(siteLocation).where(eq(siteLocation.id, liveLocId));
      await db.delete(siteLocation).where(eq(siteLocation.id, deletedLocId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("the same admin row appears once it is live again", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const adminId = randomUUID();

    try {
      await db.insert(site).values([{ id: siteId, name: `scope-rev-site-${siteId}` }]);
      await db.insert(siteLocation).values([
        { id: locId, siteId, name: "Scope Revive Loc" },
      ]);
      await db.insert(user).values([
        {
          id: adminId,
          name: "Scope Revive Admin",
          email: `scope-rev-${adminId}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteId,
          siteLocationId: locId,
        },
      ]);
      await db.update(user).set({ deletedAt: sql`now()` }).where(eq(user.id, adminId));

      const filter = userScopeFilter({ role: "ho", siteId });
      const whileDeleted = await db
        .select({ id: user.id })
        .from(user)
        .where(filter);
      expect(whileDeleted).toEqual([]);

      await db.update(user).set({ deletedAt: null }).where(eq(user.id, adminId));
      const whileLive = await db.select({ id: user.id }).from(user).where(filter);
      expect(whileLive).toEqual([{ id: adminId }]);
    } finally {
      await db.delete(user).where(eq(user.id, adminId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
