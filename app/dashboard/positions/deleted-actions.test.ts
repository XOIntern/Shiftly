import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { position } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedLocation,
  seedMpRequest,
  seedPosition,
  seedRequestLine,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

// The actions resolve their actor through requireUser (all three roles manage
// their own scope) and requireSuperadmin (permanent delete). The stubs keep
// the real contracts' shape: only a superadmin passes requireSuperadmin (the
// real one redirects, which throws). The mock swaps the WHOLE module across
// bun's single test process, so every export other suites may resolve must
// exist here.
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

function actorOf(
  role: SessionUser["role"],
  siteId: string | null = null,
  siteLocationId: string | null = null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T191 Actor",
    email: `t191-pos-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

async function stateOf(id: string): Promise<"missing" | "deleted" | "live"> {
  const [row] = await db
    .select({ deletedAt: position.deletedAt })
    .from(position)
    .where(eq(position.id, id));
  if (!row) return "missing";
  return row.deletedAt ? "deleted" : "live";
}

// A deleted position the purge must refuse: a request line names it.
async function seedPositionWithHistory(siteId: string): Promise<string> {
  const loc = await seedLocation(cleanup, siteId);
  const pos = await seedPosition(cleanup, siteId, { deleted: true });
  const area = await seedWorkArea(cleanup, loc, {
    positionIds: [pos.id],
    deleted: true,
  });
  const shift = await seedShift(cleanup, loc, { deleted: true });
  const author = await seedUser(cleanup, { role: "superadmin" });
  const request = await seedMpRequest(cleanup, loc, { createdBy: author.id });
  await seedRequestLine(cleanup, {
    requestId: request.id,
    loc,
    workAreaId: area.id,
    shiftId: shift.id,
    positionId: pos.id,
  });
  return pos.id;
}

describe("restorePosition", () => {
  test("a superadmin brings a deleted position back and revalidates the list", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restorePosition } = await import("./actions");

    expect(await restorePosition(pos.id)).toEqual({ ok: true });
    expect(await stateOf(pos.id)).toBe("live");
    expect(revalidated).toContain("/dashboard/positions");
  });

  test("an HO restores a deleted position of their own site", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("ho", site.id);

    const { restorePosition } = await import("./actions");

    expect(await restorePosition(pos.id)).toEqual({ ok: true });
  });

  test("an admin restores a deleted position of their location's site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("admin", site.id, loc.id);

    const { restorePosition } = await import("./actions");

    expect(await restorePosition(pos.id)).toEqual({ ok: true });
  });

  test("an HO or admin never restores another site's deleted position", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const otherLoc = await seedLocation(cleanup, otherSite.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    const { restorePosition } = await import("./actions");

    actor = actorOf("ho", otherSite.id);
    expect(await restorePosition(pos.id)).toEqual({
      ok: false,
      message: "Deleted position not found.",
    });
    actor = actorOf("admin", otherSite.id, otherLoc.id);
    expect(await restorePosition(pos.id)).toEqual({
      ok: false,
      message: "Deleted position not found.",
    });
    expect(await stateOf(pos.id)).toBe("deleted");
  });

  test("a deleted site refuses the restore", async () => {
    const site = await seedSite(cleanup, { deleted: true });
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");

    const { restorePosition } = await import("./actions");

    expect(await restorePosition(pos.id)).toEqual({
      ok: false,
      message: "Site is deleted; restore it first",
    });
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { restorePosition } = await import("./actions");

    expect(await restorePosition("nope")).toEqual({
      ok: false,
      message: "Invalid position id.",
    });
  });
});

describe("restoreBulk", () => {
  test("restores what it can and reports the rest as skipped", async () => {
    const site = await seedSite(cleanup);
    const clashName = `t191-bulk-clash-${randomUUID()}`;
    const a = await seedPosition(cleanup, site.id, { deleted: true });
    const b = await seedPosition(cleanup, site.id, { deleted: true });
    const clash = await seedPosition(cleanup, site.id, {
      deleted: true,
      name: clashName,
    });
    await seedPosition(cleanup, site.id, { name: clashName });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, b.id, clash.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 position skipped: Position name already exists",
    );
    expect(await stateOf(a.id)).toBe("live");
    expect(await stateOf(clash.id)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/positions");
  });

  test("an HO's batch never reaches another site's rows", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const mine = await seedPosition(cleanup, site.id, { deleted: true });
    const theirs = await seedPosition(cleanup, otherSite.id, { deleted: true });
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
    const a = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, a.id, "nope"]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(await restoreBulk([])).toEqual({
      ok: false,
      message: "No positions selected.",
    });
  });
});

describe("purgePosition", () => {
  test("a superadmin deletes an unreferenced deleted position for good", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgePosition } = await import("./actions");

    expect(await purgePosition(pos.id)).toEqual({ ok: true });
    expect(await stateOf(pos.id)).toBe("missing");
    expect(revalidated).toContain("/dashboard/positions");
  });

  test("a position with request history is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const id = await seedPositionWithHistory(site.id);
    actor = actorOf("superadmin");

    const { purgePosition } = await import("./actions");

    expect(await purgePosition(id)).toEqual({
      ok: false,
      message: "Position has request history and cannot be permanently deleted",
    });
    expect(await stateOf(id)).toBe("deleted");
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { purgePosition } = await import("./actions");

    expect(await purgePosition("nope")).toEqual({
      ok: false,
      message: "Invalid position id.",
    });
  });

  test("an HO and an admin are turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    const { purgePosition } = await import("./actions");

    actor = actorOf("ho", site.id);
    await expect(purgePosition(pos.id)).rejects.toThrow("NEXT_REDIRECT");
    actor = actorOf("admin", site.id, loc.id);
    await expect(purgePosition(pos.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(pos.id)).toBe("deleted");
  });
});

describe("purgeBulk", () => {
  test("deletes what it can and reports history-bound positions as skipped", async () => {
    const site = await seedSite(cleanup);
    const a = await seedPosition(cleanup, site.id, { deleted: true });
    const b = await seedPosition(cleanup, site.id, { deleted: true });
    const withHistory = await seedPositionWithHistory(site.id);
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([a.id, withHistory, b.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 position skipped: Position has request history and cannot be permanently deleted",
    );
    expect(await stateOf(a.id)).toBe("missing");
    expect(await stateOf(withHistory)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/positions");
  });

  test("a live position in the selection is skipped, not deleted", async () => {
    const site = await seedSite(cleanup);
    const live = await seedPosition(cleanup, site.id);
    const gone = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("superadmin");

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([live.id, gone.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 position skipped: Deleted position not found.",
    );
    expect(await stateOf(live.id)).toBe("live");
  });

  test("an HO is turned away", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    actor = actorOf("ho", site.id);

    const { purgeBulk } = await import("./actions");

    await expect(purgeBulk([pos.id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(pos.id)).toBe("deleted");
  });
});
