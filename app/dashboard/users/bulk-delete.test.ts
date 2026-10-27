import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// Same stub set as bulk-active.test.ts: the session module swaps wholesale,
// revalidation is a no-op, and session wipes are recorded instead of written.
const sessionWipes: string[] = [];
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));
// mock.module is process-wide and patches the loaded module in place: the
// real exports are snapshotted by spread at load, the stub goes in only while
// this file runs (beforeAll), and the real ones are put back (afterAll) so
// later files see the real module.
const realCredentialStore = { ...(await import("@/lib/credential-store")) };
beforeAll(() => {
  mock.module("@/lib/credential-store", () => ({
    deleteUserSessions: async (userId: string) => {
      sessionWipes.push(userId);
    },
    setCredentialPassword: async () => 0,
  }));
});
afterAll(() => {
  mock.module("@/lib/credential-store", () => realCredentialStore);
});

function isDeleted(id: string): Promise<boolean> {
  return db
    .select({ deletedAt: user.deletedAt })
    .from(user)
    .where(eq(user.id, id))
    .then(([row]) => !!row?.deletedAt);
}

describe("deleteUserBulk (bulk soft delete)", () => {
  // The stub push targets a module-level array — clear it per test so the
  // wipe assertions see only the batch under test.
  beforeEach(() => {
    sessionWipes.length = 0;
  });

  test("ho bulk-deletes only its site's admins; self and foreign rows survive", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const hoActor = randomUUID();
    const adminA = randomUUID();
    const adminB = randomUUID();
    const hoForeign = randomUUID();

    const mkEmail = (id: string) => `bdusers-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `bdusers-site-a-${siteA}` },
        { id: siteB, name: `bdusers-site-b-${siteB}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "BDUsers Bulk Loc A" },
        { id: locB, siteId: siteB, name: "BDUsers Bulk Loc B" },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "BDUsers Actor HO",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: hoForeign,
          name: "BDUsers Foreign HO",
          email: mkEmail(hoForeign),
          emailVerified: true,
          role: "ho",
          siteId: siteB,
        },
        {
          id: adminA,
          name: "BDUsers Admin A",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: adminB,
          name: "BDUsers Admin B",
          email: mkEmail(adminB),
          emailVerified: true,
          role: "admin",
          siteLocationId: locB,
        },
      ]);

      actor = {
        id: hoActor,
        name: "BDUsers Actor HO",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteUserBulk } = await import("./actions");
      const result = await deleteUserBulk([adminA, adminB, hoActor, hoForeign]);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(await isDeleted(adminA)).toBe(true);
      expect(await isDeleted(adminB)).toBe(false);
      expect(await isDeleted(hoForeign)).toBe(false);
      expect(await isDeleted(hoActor)).toBe(false);

      // Sessions wiped for the deleted row only.
      expect(sessionWipes).toEqual([adminA]);
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, hoForeign));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(user).where(eq(user.id, adminB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("an already soft-deleted row is never resurrected by the batch", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const hoActor = randomUUID();
    const adminA = randomUUID();
    const adminGone = randomUUID();

    const mkEmail = (id: string) => `bdusers-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `bdusers-site-c-${siteA}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "BDUsers Bulk Loc C" },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "BDUsers Actor HO C",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: adminA,
          name: "BDUsers Admin C",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: adminGone,
          name: "BDUsers Admin Gone",
          email: mkEmail(adminGone),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
          deletedAt: new Date(),
        },
      ]);

      actor = {
        id: hoActor,
        name: "BDUsers Actor HO C",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteUserBulk } = await import("./actions");
      const result = await deleteUserBulk([adminA, adminGone]);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(await isDeleted(adminA)).toBe(true);
      // The pre-deleted row stays deleted — and its wipe must not fire,
      // mirroring the weld that keeps the write from touching it.
      expect(await isDeleted(adminGone)).toBe(true);
      expect(sessionWipes).toEqual([adminA]);
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(user).where(eq(user.id, adminGone));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("superadmin bulk-deletes, self excluded; empty batch is a no-op", async () => {
    const superActor = randomUUID();
    const hoTarget = randomUUID();

    const mkEmail = (id: string) => `bdusers-${id}@shiftly.test`;
    try {
      await db.insert(user).values([
        {
          id: superActor,
          name: "BDUsers Actor Super",
          email: mkEmail(superActor),
          emailVerified: true,
          role: "superadmin",
        },
        {
          id: hoTarget,
          name: "BDUsers HO Target",
          email: mkEmail(hoTarget),
          emailVerified: true,
          role: "ho",
        },
      ]);

      actor = {
        id: superActor,
        name: "BDUsers Actor Super",
        email: mkEmail(superActor),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteUserBulk } = await import("./actions");
      const result = await deleteUserBulk([hoTarget, superActor]);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(await isDeleted(hoTarget)).toBe(true);
      expect(await isDeleted(superActor)).toBe(false);

      // Same guard contract as setActiveBulk: an empty batch is a caller
      // error, not a silent success.
      const empty = await deleteUserBulk([]);
      expect(empty.ok).toBe(false);
      expect(empty.applied).toBeUndefined();
    } finally {
      await db.delete(user).where(eq(user.id, superActor));
      await db.delete(user).where(eq(user.id, hoTarget));
    }
  });
});
