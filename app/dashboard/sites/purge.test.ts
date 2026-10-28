import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditLog, site, user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// purgeSite resolves its actor through requireSuperadmin. The stub keeps the
// real contract's shape: anyone but a superadmin is turned away (the real one
// redirects, which throws), so the authorization test can tell whether the
// action asked first. The mock swaps the WHOLE module across bun's single
// test process, so every export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => {
    if (actor.role !== "superadmin") throw new Error("NEXT_REDIRECT");
    return actor;
  },
}));
// No Next request context under bun test. Real exports kept (module mocks are
// process-wide); only revalidatePath is replaced.
const realNextCache = { ...(await import("next/cache")) };
const revalidated: string[] = [];
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

function superadmin(): SessionUser {
  return {
    id: randomUUID(),
    name: "T185 Superadmin Actor",
    email: `t185-purge-${randomUUID()}@shiftly.test`,
    role: "superadmin",
    siteId: null,
    siteLocationId: null,
    isActive: true,
  };
}

async function seedSite(deleted: boolean): Promise<string> {
  const id = randomUUID();
  fixtureCleanup.defer(async () => {
    await db.delete(site).where(eq(site.id, id));
  });
  await db.insert(site).values({
    id,
    name: `t185-purge-action-${id}`,
    isActive: false,
    deletedAt: deleted ? new Date() : null,
  });
  return id;
}

async function siteExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: site.id }).from(site).where(eq(site.id, id));
  return rows.length === 1;
}

describe("purgeSite", () => {
  test("permanently removes a soft-deleted site and revalidates the list", async () => {
    const id = await seedSite(true);
    actor = superadmin();
    revalidated.length = 0;

    const { purgeSite } = await import("./actions");
    const result = await purgeSite(id);

    expect(result).toEqual({ ok: true });
    expect(await siteExists(id)).toBe(false);
    expect(revalidated).toContain("/dashboard/sites");
  });

  test("a malformed id is rejected before touching the database", async () => {
    actor = superadmin();

    const { purgeSite } = await import("./actions");

    expect(await purgeSite("not-a-uuid")).toEqual({
      ok: false,
      message: "Invalid site id.",
    });
  });

  test("a site that is not soft-deleted is refused and kept", async () => {
    const id = await seedSite(false);
    actor = superadmin();

    const { purgeSite } = await import("./actions");

    expect(await purgeSite(id)).toEqual({
      ok: false,
      message: "Deleted site not found.",
    });
    expect(await siteExists(id)).toBe(true);
  });

  test("the guard's history message passes through and the site is kept", async () => {
    const actorUser = superadmin();
    fixtureCleanup.defer(async () => {
      await db.delete(user).where(eq(user.id, actorUser.id));
    });
    await db.insert(user).values({
      id: actorUser.id,
      name: actorUser.name,
      email: actorUser.email,
      emailVerified: true,
      role: "superadmin",
    });
    const id = await seedSite(true);
    fixtureCleanup.defer(async () => {
      await db.delete(auditLog).where(eq(auditLog.siteId, id));
    });
    await db.insert(auditLog).values({
      actorId: actorUser.id,
      action: "test.purge",
      siteId: id,
      details: {},
    });
    actor = actorUser;

    const { purgeSite } = await import("./actions");

    expect(await purgeSite(id)).toEqual({
      ok: false,
      message: "Site has audit history and cannot be permanently deleted",
    });
    expect(await siteExists(id)).toBe(true);
  });

  test("anyone but a superadmin is turned away before anything is deleted", async () => {
    const id = await seedSite(true);
    actor = { ...superadmin(), role: "ho", siteId: id };

    const { purgeSite } = await import("./actions");

    await expect(purgeSite(id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await siteExists(id)).toBe(true);
  });
});
