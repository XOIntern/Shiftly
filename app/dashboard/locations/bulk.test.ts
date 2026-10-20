import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The bulk actions resolve their actor through requireHO — swapped for a
// stub so the real server actions read against the test database. The mock
// swaps the WHOLE module across bun's single test process, so every export
// other suites may resolve must exist here.
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

function locationRow(id: string, siteId: string, name: string) {
  return { id, siteId, name };
}

describe("locations bulk actions", () => {
  test("ho rewrites only its own site's locations; foreign rows untouched", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locC = randomUUID();
    const locB = randomUUID();
    const hoActor = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteA, name: `t4-loc-sc-alpha-${siteA}` },
        { id: siteB, name: `t4-loc-sc-beta-${siteB}` },
      ]);
      await db
        .insert(siteLocation)
        .values([
          locationRow(locA, siteA, "T4 Loc A"),
          locationRow(locC, siteA, "T4 Loc C"),
          locationRow(locB, siteB, "T4 Loc B"),
        ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO",
        email: `t4-loc-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk([locA, locC, locB], false);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(2);

      const rows = await db
        .select({ id: siteLocation.id, isActive: siteLocation.isActive })
        .from(siteLocation);
      const stateOf = (id: string) =>
        rows.find((row) => row.id === id)?.isActive;
      expect(stateOf(locA)).toBe(false);
      expect(stateOf(locC)).toBe(false);
      expect(stateOf(locB)).toBe(true);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locC));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("deleteBulk unregisters free locations, skips user-bound ones", async () => {
    const siteA = randomUUID();
    const free = randomUUID();
    const bound = randomUUID();
    const foreign = randomUUID();
    const adminA = randomUUID();
    const hoActor = randomUUID();

    try {
      await db
        .insert(site)
        .values([{ id: siteA, name: `t4-loc-del-${siteA}` }]);
      await db
        .insert(siteLocation)
        .values([
          locationRow(free, siteA, "T4 Loc Free"),
          locationRow(bound, siteA, "T4 Loc Bound"),
        ]);
      // A foreign site's location, never the ho's to touch.
      const foreignSite = randomUUID();
      await db
        .insert(site)
        .values([{ id: foreignSite, name: `t4-loc-fs-${foreignSite}` }]);
      await db
        .insert(siteLocation)
        .values([locationRow(foreign, foreignSite, "T4 Loc Foreign")]);
      await db.insert(user).values([
        {
          id: adminA,
          name: "T4 Admin",
          email: `t4-loc-${adminA}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: bound,
        },
        {
          id: hoActor,
          name: "T4 Actor HO",
          email: `t4-loc-${hoActor}@shiftly.test`,
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO",
        email: `t4-loc-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteBulk } = await import("./actions");
      const result = await deleteBulk([free, bound, foreign]);

      // The free location soft-deletes (its row survives with deletedAt),
      // the user-bound one is skipped with the same guard message the
      // single-row path gives, and the foreign one never even appears in
      // the counts. Soft-delete epic #41.
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.message).toContain("Users are still bound");

      const rows = await db
        .select({ id: siteLocation.id, deletedAt: siteLocation.deletedAt })
        .from(siteLocation);
      const freeRow = rows.find((row) => row.id === free);
      expect(freeRow).toBeDefined();
      expect(freeRow?.deletedAt).not.toBeNull();
      expect(rows.find((row) => row.id === bound)?.deletedAt).toBeNull();
      expect(rows.find((row) => row.id === foreign)?.deletedAt).toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(siteLocation).where(eq(siteLocation.id, free));
      await db.delete(siteLocation).where(eq(siteLocation.id, bound));
      await db.delete(siteLocation).where(eq(siteLocation.id, foreign));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("an unbound ho (siteId null) matches nothing, fail closed", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const hoActor = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t4-loc-ub-${siteA}` }]);
      await db
        .insert(siteLocation)
        .values([locationRow(locA, siteA, "T4 Loc UB")]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T4 Unbound HO",
          email: `t4-loc-${hoActor}@shiftly.test`,
          emailVerified: true,
          role: "ho",
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Unbound HO",
        email: `t4-loc-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk, deleteBulk } = await import("./actions");
      const active = await setActiveBulk([locA], false);
      expect(active.ok).toBe(true);
      expect(active.applied).toBe(0);

      const removed = await deleteBulk([locA]);
      expect(removed.ok).toBe(true);
      expect(removed.applied).toBe(0);
      expect(removed.blocked).toBe(0);

      const rows = await db.select({ id: siteLocation.id }).from(siteLocation);
      expect(rows.find((row) => row.id === locA)).toBeDefined();
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });
});
