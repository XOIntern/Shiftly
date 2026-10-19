import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The bulk action resolves its actor through requireHO — swapped for a stub
// so the real server action reads against the test database without a Next
// request context. deleteUserSessions is spied so the fixture runs stay
// free of Better Auth session rows.
const sessionWipes: string[] = [];
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  // The session mock swaps the WHOLE module across bun's single test
  // process, so every export other suites may resolve must exist here.
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test — revalidation is a no-op stub.
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));
mock.module("@/lib/credential-store", () => ({
  deleteUserSessions: async (userId: string) => {
    sessionWipes.push(userId);
  },
  setCredentialPassword: async () => 0,
}));

async function isActive(id: string): Promise<boolean> {
  const [row] = await db
    .select({ isActive: user.isActive })
    .from(user)
    .where(eq(user.id, id));
  return !!row && row.isActive;
}

// Shared fixture shape: one empty unrelated row keeps the table non-empty
// and proves the WHERE never widens beyond the request.
describe("setActiveBulk (bulk deactivation)", () => {
  test("ho deactivates only its site's admins; foreign rows and self stay active", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const hoActor = randomUUID();
    const hoForeign = randomUUID();
    const adminA = randomUUID();
    const adminB = randomUUID();
    const superadminRow = randomUUID();

    const mkEmail = (id: string) => `t4-users-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `t4-users-site-alpha-${siteA}` },
        { id: siteB, name: `t4-users-site-beta-${siteB}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T4 Users Bulk Loc A" },
        { id: locB, siteId: siteB, name: "T4 Users Bulk Loc B" },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T4 Actor HO",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: hoForeign,
          name: "T4 Foreign HO",
          email: mkEmail(hoForeign),
          emailVerified: true,
          role: "ho",
          siteId: siteB,
        },
        {
          id: superadminRow,
          name: "T4 Superadmin",
          email: mkEmail(superadminRow),
          emailVerified: true,
          role: "superadmin",
        },
        {
          id: adminA,
          name: "T4 Admin A",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: adminB,
          name: "T4 Admin B",
          email: mkEmail(adminB),
          emailVerified: true,
          role: "admin",
          siteLocationId: locB,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk(
        [adminA, adminB, hoActor, superadminRow],
        false,
      );

      // Only the own-site admin applied; the rest were skipped, not errors.
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(await isActive(adminA)).toBe(false);
      expect(await isActive(adminB)).toBe(true);
      expect(await isActive(hoForeign)).toBe(true);
      expect(await isActive(superadminRow)).toBe(true);
      expect(await isActive(hoActor)).toBe(true);

      // Exactly one session wipe, for the row that actually changed.
      expect(sessionWipes).toEqual([adminA]);
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, hoForeign));
      await db.delete(user).where(eq(user.id, superadminRow));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(user).where(eq(user.id, adminB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("deactivating the actor's own id stays out of the batch", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const hoActor = randomUUID();
    const adminA = randomUUID();

    const mkEmail = (id: string) => `t4-users-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `t4-users-site-gamma-${siteA}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T4 Users Bulk Loc G" },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T4 Actor HO G",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: adminA,
          name: "T4 Admin G",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO G",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk([hoActor, adminA], false);

      // The actor survives their own bulk deactivation; the rest applies.
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(await isActive(hoActor)).toBe(true);
      expect(await isActive(adminA)).toBe(false);
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("malformed ids are dropped from the batch, not fatal", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const hoActor = randomUUID();
    const adminA = randomUUID();

    const mkEmail = (id: string) => `t4-users-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `t4-users-site-delta-${siteA}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T4 Users Bulk Loc D" },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T4 Actor HO D",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: adminA,
          name: "T4 Admin D",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO D",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk(
        ["not-a-uuid", adminA],
        false,
      );

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(await isActive(adminA)).toBe(false);
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("deactivates a better-auth non-uuid ho id (user.id is text, not uuid)", async () => {
    // better-auth minted ids are 32-char random strings, not uuids.
    const superActor = "superAcctAaBbCcDdEeFfGgHhIiJjKkLlMm01";
    const hoTarget = "hoTargetAaBbCcDdEeFfGgHhIiJjKkLlMmN2";
    const mkEmail = (id: string) => `t4-users-${id.slice(0, 8)}@shiftly.test`;

    try {
      await db.insert(user).values([
        {
          id: superActor,
          name: "T4 Actor Super G",
          email: mkEmail(superActor),
          emailVerified: true,
          role: "superadmin",
        },
        {
          id: hoTarget,
          name: "T4 HO Target G",
          email: mkEmail(hoTarget),
          emailVerified: true,
          role: "ho",
        },
      ]);

      actor = {
        id: superActor,
        name: "T4 Actor Super G",
        email: mkEmail(superActor),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk([hoTarget], false);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(await isActive(hoTarget)).toBe(false);
    } finally {
      await db.delete(user).where(eq(user.id, superActor));
      await db.delete(user).where(eq(user.id, hoTarget));
    }
  });

  test("an unbound ho (siteId null) matches nothing, fail closed", async () => {
    const hoActor = randomUUID();
    const adminA = randomUUID();
    const siteA = randomUUID();
    const locA = randomUUID();

    const mkEmail = (id: string) => `t4-users-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `t4-users-site-eps-${siteA}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T4 Users Bulk Loc E" },
      ]);
      await db.insert(user).values([
        {
          id: adminA,
          name: "T4 Admin E",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: hoActor,
          name: "T4 Unbound HO",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Unbound HO",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk([adminA], false);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(0);
      expect(await isActive(adminA)).toBe(true);
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });
});
