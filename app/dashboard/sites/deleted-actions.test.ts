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

// The actions resolve their actor through requireSuperadmin. The stub keeps the
// real contract's shape: anyone but a superadmin is turned away (the real one
// redirects, which throws). The mock swaps the WHOLE module across bun's single
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
    email: `t185-deleted-${randomUUID()}@shiftly.test`,
    role: "superadmin",
    siteId: null,
    siteLocationId: null,
    isActive: true,
  };
}

async function seedSite(opts: {
  deleted: boolean;
  name?: string;
}): Promise<string> {
  const id = randomUUID();
  fixtureCleanup.defer(async () => {
    await db.delete(site).where(eq(site.id, id));
  });
  await db.insert(site).values({
    id,
    name: opts.name ?? `t185-deleted-actions-${id}`,
    isActive: false,
    deletedAt: opts.deleted ? new Date() : null,
  });
  return id;
}

// A deleted site that purge must refuse: one audit row on it, authored by an
// actor that is not one of its users.
async function seedSiteWithHistory(): Promise<string> {
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
  const id = await seedSite({ deleted: true });
  fixtureCleanup.defer(async () => {
    await db.delete(auditLog).where(eq(auditLog.siteId, id));
  });
  await db.insert(auditLog).values({
    actorId: actorUser.id,
    action: "test.history",
    siteId: id,
    details: {},
  });
  return id;
}

async function stateOf(id: string): Promise<"missing" | "deleted" | "live"> {
  const [row] = await db
    .select({ deletedAt: site.deletedAt })
    .from(site)
    .where(eq(site.id, id));
  if (!row) return "missing";
  return row.deletedAt ? "deleted" : "live";
}

describe("restoreSite", () => {
  test("brings a deleted site back and revalidates the list", async () => {
    const id = await seedSite({ deleted: true });
    actor = superadmin();
    revalidated.length = 0;

    const { restoreSite } = await import("./actions");

    expect(await restoreSite(id)).toEqual({ ok: true });
    expect(await stateOf(id)).toBe("live");
    expect(revalidated).toContain("/dashboard/sites");
  });

  test("a malformed id is rejected", async () => {
    actor = superadmin();

    const { restoreSite } = await import("./actions");

    expect(await restoreSite("nope")).toEqual({
      ok: false,
      message: "Invalid site id.",
    });
  });

  test("a live site is refused", async () => {
    const id = await seedSite({ deleted: false });
    actor = superadmin();

    const { restoreSite } = await import("./actions");

    expect(await restoreSite(id)).toEqual({
      ok: false,
      message: "Deleted site not found.",
    });
  });

  test("a name now used by a live site is refused with the duplicate message", async () => {
    const name = `t185-deleted-clash-${randomUUID()}`;
    const id = await seedSite({ deleted: true, name });
    await seedSite({ deleted: false, name });
    actor = superadmin();

    const { restoreSite } = await import("./actions");

    expect(await restoreSite(id)).toEqual({
      ok: false,
      message: "A site with this name already exists",
    });
    expect(await stateOf(id)).toBe("deleted");
  });

  test("anyone but a superadmin is turned away", async () => {
    const id = await seedSite({ deleted: true });
    actor = { ...superadmin(), role: "ho", siteId: id };

    const { restoreSite } = await import("./actions");

    await expect(restoreSite(id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(id)).toBe("deleted");
  });
});

describe("restoreBulk", () => {
  test("restores what it can and reports the rest as skipped", async () => {
    const clashName = `t185-deleted-bulk-clash-${randomUUID()}`;
    const a = await seedSite({ deleted: true });
    const b = await seedSite({ deleted: true });
    const clash = await seedSite({ deleted: true, name: clashName });
    await seedSite({ deleted: false, name: clashName });
    actor = superadmin();
    revalidated.length = 0;

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a, b, clash]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 site skipped: A site with this name already exists",
    );
    expect(await stateOf(a)).toBe("live");
    expect(await stateOf(b)).toBe("live");
    expect(await stateOf(clash)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/sites");
  });

  test("malformed and repeated ids are dropped before anything runs", async () => {
    const a = await seedSite({ deleted: true });
    actor = superadmin();

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a, a, "nope"]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(result.message).toBeUndefined();
  });

  test("nothing valid selected is an error", async () => {
    actor = superadmin();

    const { restoreBulk } = await import("./actions");

    expect(await restoreBulk(["nope"])).toEqual({
      ok: false,
      message: "No sites selected.",
    });
    expect(await restoreBulk([])).toEqual({
      ok: false,
      message: "No sites selected.",
    });
  });

  test("anyone but a superadmin is turned away", async () => {
    const id = await seedSite({ deleted: true });
    actor = { ...superadmin(), role: "admin" };

    const { restoreBulk } = await import("./actions");

    await expect(restoreBulk([id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(id)).toBe("deleted");
  });
});

describe("purgeBulk", () => {
  test("deletes what it can and reports history-bound sites as skipped", async () => {
    const a = await seedSite({ deleted: true });
    const b = await seedSite({ deleted: true });
    const withHistory = await seedSiteWithHistory();
    actor = superadmin();
    revalidated.length = 0;

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([a, withHistory, b]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 site skipped: Site has audit history and cannot be permanently deleted",
    );
    expect(await stateOf(a)).toBe("missing");
    expect(await stateOf(b)).toBe("missing");
    expect(await stateOf(withHistory)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/sites");
  });

  test("a live site in the selection is skipped, not deleted", async () => {
    const live = await seedSite({ deleted: false });
    const gone = await seedSite({ deleted: true });
    actor = superadmin();

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([live, gone]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe("1 site skipped: Deleted site not found.");
    expect(await stateOf(live)).toBe("live");
    expect(await stateOf(gone)).toBe("missing");
  });

  test("malformed and repeated ids are dropped; nothing valid is an error", async () => {
    const a = await seedSite({ deleted: true });
    actor = superadmin();

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([a, a, "nope"]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(await purgeBulk([])).toEqual({
      ok: false,
      message: "No sites selected.",
    });
  });

  test("anyone but a superadmin is turned away", async () => {
    const id = await seedSite({ deleted: true });
    actor = { ...superadmin(), role: "ho" };

    const { purgeBulk } = await import("./actions");

    await expect(purgeBulk([id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(id)).toBe("deleted");
  });
});
