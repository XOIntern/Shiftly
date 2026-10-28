import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAuditLog,
  seedLocation,
  seedSite,
  seedUser,
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

// The actions resolve their actor through requireHO / requireSuperadmin. The
// stubs keep the real contracts' shape: an admin never passes requireHO, and
// only a superadmin passes requireSuperadmin (the real ones redirect, which
// throws). The mock swaps the WHOLE module across bun's single test process,
// so every export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => {
    if (actor.role === "admin") throw new Error("NEXT_REDIRECT");
    return actor;
  },
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

function actorOf(
  role: SessionUser["role"],
  siteId: string | null = null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T190 Actor",
    email: `t190-deleted-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId: null,
    isActive: true,
  };
}

async function stateOf(id: string): Promise<"missing" | "deleted" | "live"> {
  const [row] = await db
    .select({ deletedAt: siteLocation.deletedAt })
    .from(siteLocation)
    .where(eq(siteLocation.id, id));
  if (!row) return "missing";
  return row.deletedAt ? "deleted" : "live";
}

// A deleted location the purge must refuse: one audit row at it, authored by
// an actor that is not one of its users.
async function seedLocationWithHistory(siteId: string): Promise<string> {
  const author = await seedUser(cleanup, { role: "superadmin" });
  const loc = await seedLocation(cleanup, siteId, { deleted: true });
  await seedAuditLog(cleanup, { actorId: author.id, siteLocationId: loc.id });
  return loc.id;
}

describe("restoreLocation", () => {
  test("a superadmin brings a deleted location back and revalidates the list", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreLocation } = await import("./actions");

    expect(await restoreLocation(loc.id)).toEqual({ ok: true });
    expect(await stateOf(loc.id)).toBe("live");
    expect(revalidated).toContain("/dashboard/locations");
  });

  test("an HO restores a deleted location of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("ho", site.id);

    const { restoreLocation } = await import("./actions");

    expect(await restoreLocation(loc.id)).toEqual({ ok: true });
    expect(await stateOf(loc.id)).toBe("live");
  });

  test("an HO never restores another site's deleted location", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, otherSite.id, { deleted: true });
    actor = actorOf("ho", site.id);

    const { restoreLocation } = await import("./actions");

    expect(await restoreLocation(loc.id)).toEqual({
      ok: false,
      message: "Deleted location not found.",
    });
    expect(await stateOf(loc.id)).toBe("deleted");
  });

  test("a deleted site refuses the restore", async () => {
    const site = await seedSite(cleanup, { deleted: true });
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");

    const { restoreLocation } = await import("./actions");

    expect(await restoreLocation(loc.id)).toEqual({
      ok: false,
      message: "Site is deleted; restore it first",
    });
    expect(await stateOf(loc.id)).toBe("deleted");
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { restoreLocation } = await import("./actions");

    expect(await restoreLocation("nope")).toEqual({
      ok: false,
      message: "Invalid location id.",
    });
  });

  test("an admin is turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("admin", site.id);

    const { restoreLocation } = await import("./actions");

    await expect(restoreLocation(loc.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(loc.id)).toBe("deleted");
  });
});

describe("restoreBulk", () => {
  test("restores what it can and reports the rest as skipped", async () => {
    const site = await seedSite(cleanup);
    const clashName = `t190-bulk-clash-${randomUUID()}`;
    const a = await seedLocation(cleanup, site.id, { deleted: true });
    const b = await seedLocation(cleanup, site.id, { deleted: true });
    const clash = await seedLocation(cleanup, site.id, {
      deleted: true,
      name: clashName,
    });
    await seedLocation(cleanup, site.id, { name: clashName });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, b.id, clash.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 location skipped: Location name already exists",
    );
    expect(await stateOf(a.id)).toBe("live");
    expect(await stateOf(b.id)).toBe("live");
    expect(await stateOf(clash.id)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/locations");
  });

  test("an HO's batch never reaches another site's rows", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const mine = await seedLocation(cleanup, site.id, { deleted: true });
    const theirs = await seedLocation(cleanup, otherSite.id, { deleted: true });
    actor = actorOf("ho", site.id);

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([mine.id, theirs.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(await stateOf(mine.id)).toBe("live");
    expect(await stateOf(theirs.id)).toBe("deleted");
  });

  test("malformed and repeated ids are dropped; nothing valid is an error", async () => {
    const site = await seedSite(cleanup);
    const a = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, a.id, "nope"]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(result.message).toBeUndefined();
    expect(await restoreBulk([])).toEqual({
      ok: false,
      message: "No locations selected.",
    });
  });

  test("an admin is turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("admin", site.id);

    const { restoreBulk } = await import("./actions");

    await expect(restoreBulk([loc.id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(loc.id)).toBe("deleted");
  });
});

describe("purgeLocation", () => {
  test("a superadmin deletes a clean deleted location for good", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeLocation } = await import("./actions");

    expect(await purgeLocation(loc.id)).toEqual({ ok: true });
    expect(await stateOf(loc.id)).toBe("missing");
    expect(revalidated).toContain("/dashboard/locations");
  });

  test("a location with history is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const id = await seedLocationWithHistory(site.id);
    actor = actorOf("superadmin");

    const { purgeLocation } = await import("./actions");

    expect(await purgeLocation(id)).toEqual({
      ok: false,
      message: "Location has audit history and cannot be permanently deleted",
    });
    expect(await stateOf(id)).toBe("deleted");
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { purgeLocation } = await import("./actions");

    expect(await purgeLocation("nope")).toEqual({
      ok: false,
      message: "Invalid location id.",
    });
  });

  test("an HO is turned away, even for their own site's location", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("ho", site.id);

    const { purgeLocation } = await import("./actions");

    await expect(purgeLocation(loc.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(loc.id)).toBe("deleted");
  });
});

describe("purgeBulk", () => {
  test("deletes what it can and reports history-bound locations as skipped", async () => {
    const site = await seedSite(cleanup);
    const a = await seedLocation(cleanup, site.id, { deleted: true });
    const b = await seedLocation(cleanup, site.id, { deleted: true });
    const withHistory = await seedLocationWithHistory(site.id);
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([a.id, withHistory, b.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 location skipped: Location has audit history and cannot be permanently deleted",
    );
    expect(await stateOf(a.id)).toBe("missing");
    expect(await stateOf(b.id)).toBe("missing");
    expect(await stateOf(withHistory)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/locations");
  });

  test("a live location in the selection is skipped, not deleted", async () => {
    const site = await seedSite(cleanup);
    const live = await seedLocation(cleanup, site.id);
    const gone = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([live.id, gone.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 location skipped: Deleted location not found.",
    );
    expect(await stateOf(live.id)).toBe("live");
    expect(await stateOf(gone.id)).toBe("missing");
  });

  test("nothing valid selected is an error", async () => {
    actor = actorOf("superadmin");

    const { purgeBulk } = await import("./actions");

    expect(await purgeBulk(["nope"])).toEqual({
      ok: false,
      message: "No locations selected.",
    });
  });

  test("an HO is turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    actor = actorOf("ho", site.id);

    const { purgeBulk } = await import("./actions");

    await expect(purgeBulk([loc.id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(loc.id)).toBe("deleted");
  });
});
