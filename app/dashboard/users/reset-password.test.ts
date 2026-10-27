import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// resetPassword resolves its actor through requireHO and writes through
// setCredentialPassword/deleteUserSessions — swapped here (the same
// mock.module isolation bulk-active.test.ts needs) so the real server action
// runs against the test database without a Next request context, and the
// session eviction is observed as a call instead of executed. The helper's
// own DB behavior is covered by the real-DB tests in credential-store.test.ts.
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
// bun loads every test file (running its top-level code) before any test
// runs, so a stub registered at the top level would be what a later file
// captures as "real". The real module is captured at load, the stub goes in
// for this file only (beforeAll) and the real module is put back after it
// (afterAll) — mock.module is process-wide and would otherwise leak into every
// suite that runs afterwards.
const realCredentialStore = { ...(await import("@/lib/credential-store")) };
beforeAll(() => {
  mock.module("@/lib/credential-store", () => ({
    deleteUserSessions: async (userId: string) => {
      sessionWipes.push(userId);
    },
    setCredentialPassword: async () => 1,
  }));
});
afterAll(() => {
  mock.module("@/lib/credential-store", () => realCredentialStore);
});
// bun --randomize also shuffles the tests inside a file; the wipes recorded by
// one test must not leak into the next one's exact-match assertion.
beforeEach(() => {
  sessionWipes.length = 0;
});

describe("resetPassword", () => {
  test("a successful reset evicts the target's sessions", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const hoActor = randomUUID();
    const adminA = randomUUID();

    const mkEmail = (id: string) => `t5-users-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `t5-users-site-${siteA}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T5 Users Reset Loc A" },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T5 Actor HO",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: adminA,
          name: "T5 Admin A",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T5 Actor HO",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { resetPassword } = await import("./actions");
      const result = await resetPassword(adminA, "Brand-New-Password-1");

      expect(result.ok).toBe(true);
      // The credential rewrite alone is not enough — the reset must log the
      // target out everywhere.
      expect(sessionWipes).toEqual([adminA]);
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("resets a better-auth non-uuid ho id (user.id is text, not uuid)", async () => {
    // better-auth minted ids are 32-char random strings, not uuids.
    const superActor = "superAcctAaBbCcDdEeFfGgHhIiJjKkLlMm02";
    const hoTarget = "hoTargetAaBbCcDdEeFfGgHhIiJjKkLlMmN3";

    const mkEmail = (id: string) => `t5-users-${id.slice(0, 8)}@shiftly.test`;
    const sessionWipesBefore = sessionWipes.length;
    try {
      await db.insert(user).values([
        {
          id: superActor,
          name: "T5 Actor Super B",
          email: mkEmail(superActor),
          emailVerified: true,
          role: "superadmin",
        },
        {
          id: hoTarget,
          name: "T5 HO Target B",
          email: mkEmail(hoTarget),
          emailVerified: true,
          role: "ho",
        },
      ]);

      actor = {
        id: superActor,
        name: "T5 Actor Super B",
        email: mkEmail(superActor),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { resetPassword } = await import("./actions");
      const result = await resetPassword(hoTarget, "Brand-New-Password-1");

      expect(result.ok).toBe(true);
      expect(sessionWipes.slice(sessionWipesBefore)).toEqual([hoTarget]);
    } finally {
      await db.delete(user).where(eq(user.id, superActor));
      await db.delete(user).where(eq(user.id, hoTarget));
    }
  });
});
