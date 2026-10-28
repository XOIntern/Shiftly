import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { workArea } from "@/drizzle/schema";
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
    email: `t191-area-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

async function stateOf(id: string): Promise<"missing" | "deleted" | "live"> {
  const [row] = await db
    .select({ deletedAt: workArea.deletedAt })
    .from(workArea)
    .where(eq(workArea.id, id));
  if (!row) return "missing";
  return row.deletedAt ? "deleted" : "live";
}

// A deleted work area the purge must refuse: a request line names it.
async function seedAreaWithHistory(
  loc: { id: string; siteId: string },
): Promise<string> {
  const pos = await seedPosition(cleanup, loc.siteId);
  const area = await seedWorkArea(cleanup, loc, {
    positionIds: [pos.id],
    deleted: true,
  });
  const shift = await seedShift(cleanup, loc);
  const author = await seedUser(cleanup, { role: "superadmin" });
  const request = await seedMpRequest(cleanup, loc, { createdBy: author.id });
  await seedRequestLine(cleanup, {
    requestId: request.id,
    loc,
    workAreaId: area.id,
    shiftId: shift.id,
    positionId: pos.id,
  });
  return area.id;
}

describe("restoreWorkArea", () => {
  test("a superadmin brings a deleted work area back and revalidates the list", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreWorkArea } = await import("./actions");

    expect(await restoreWorkArea(area.id)).toEqual({ ok: true });
    expect(await stateOf(area.id)).toBe("live");
    expect(revalidated).toContain("/dashboard/work-areas");
  });

  test("an HO restores a deleted work area of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });
    actor = actorOf("ho", site.id);

    const { restoreWorkArea } = await import("./actions");

    expect(await restoreWorkArea(area.id)).toEqual({ ok: true });
  });

  test("an admin restores a deleted work area of their own location only", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const mine = await seedWorkArea(cleanup, loc, { deleted: true });
    const theirs = await seedWorkArea(cleanup, sibling, { deleted: true });
    actor = actorOf("admin", site.id, loc.id);

    const { restoreWorkArea } = await import("./actions");

    expect(await restoreWorkArea(mine.id)).toEqual({ ok: true });
    expect(await restoreWorkArea(theirs.id)).toEqual({
      ok: false,
      message: "Deleted work area not found.",
    });
    expect(await stateOf(theirs.id)).toBe("deleted");
  });

  test("an HO never restores another site's deleted work area", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });
    actor = actorOf("ho", otherSite.id);

    const { restoreWorkArea } = await import("./actions");

    expect(await restoreWorkArea(area.id)).toEqual({
      ok: false,
      message: "Deleted work area not found.",
    });
    expect(await stateOf(area.id)).toBe("deleted");
  });

  test("a deleted required position refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    actor = actorOf("superadmin");

    const { restoreWorkArea } = await import("./actions");

    expect(await restoreWorkArea(area.id)).toEqual({
      ok: false,
      message: "A position this work area requires is deleted; restore it first",
    });
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { restoreWorkArea } = await import("./actions");

    expect(await restoreWorkArea("nope")).toEqual({
      ok: false,
      message: "Invalid work area id.",
    });
  });
});

describe("restoreBulk", () => {
  test("restores what it can and reports the rest as skipped", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const clashName = `t191-bulk-clash-${randomUUID()}`;
    const a = await seedWorkArea(cleanup, loc, { deleted: true });
    const b = await seedWorkArea(cleanup, loc, { deleted: true });
    const clash = await seedWorkArea(cleanup, loc, {
      deleted: true,
      name: clashName,
    });
    await seedWorkArea(cleanup, loc, { name: clashName });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, b.id, clash.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 work area skipped: Work area name already exists",
    );
    expect(await stateOf(clash.id)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/work-areas");
  });

  test("an admin's batch never reaches another location's rows", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const mine = await seedWorkArea(cleanup, loc, { deleted: true });
    const theirs = await seedWorkArea(cleanup, sibling, { deleted: true });
    actor = actorOf("admin", site.id, loc.id);

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([mine.id, theirs.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(await stateOf(mine.id)).toBe("live");
    expect(await stateOf(theirs.id)).toBe("deleted");
  });

  test("malformed and repeated ids are dropped; nothing valid is an error", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const a = await seedWorkArea(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, a.id, "nope"]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(await restoreBulk([])).toEqual({
      ok: false,
      message: "No work areas selected.",
    });
  });
});

describe("purgeWorkArea", () => {
  test("a superadmin deletes a clean deleted work area for good", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeWorkArea } = await import("./actions");

    expect(await purgeWorkArea(area.id)).toEqual({ ok: true });
    expect(await stateOf(area.id)).toBe("missing");
    expect(revalidated).toContain("/dashboard/work-areas");
  });

  test("a work area with request history is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const id = await seedAreaWithHistory(loc);
    actor = actorOf("superadmin");

    const { purgeWorkArea } = await import("./actions");

    expect(await purgeWorkArea(id)).toEqual({
      ok: false,
      message: "Work area has request history and cannot be permanently deleted",
    });
    expect(await stateOf(id)).toBe("deleted");
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { purgeWorkArea } = await import("./actions");

    expect(await purgeWorkArea("nope")).toEqual({
      ok: false,
      message: "Invalid work area id.",
    });
  });

  test("an HO and an admin are turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    const { purgeWorkArea } = await import("./actions");

    actor = actorOf("ho", site.id);
    await expect(purgeWorkArea(area.id)).rejects.toThrow("NEXT_REDIRECT");
    actor = actorOf("admin", site.id, loc.id);
    await expect(purgeWorkArea(area.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(area.id)).toBe("deleted");
  });
});

describe("purgeBulk", () => {
  test("deletes what it can and reports history-bound work areas as skipped", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const a = await seedWorkArea(cleanup, loc, { deleted: true });
    const b = await seedWorkArea(cleanup, loc, { deleted: true });
    const withHistory = await seedAreaWithHistory(loc);
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([a.id, withHistory, b.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 work area skipped: Work area has request history and cannot be permanently deleted",
    );
    expect(await stateOf(a.id)).toBe("missing");
    expect(await stateOf(withHistory)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/work-areas");
  });

  test("a live work area in the selection is skipped, not deleted", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const live = await seedWorkArea(cleanup, loc);
    const gone = await seedWorkArea(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([live.id, gone.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 work area skipped: Deleted work area not found.",
    );
    expect(await stateOf(live.id)).toBe("live");
  });

  test("an HO is turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });
    actor = actorOf("ho", site.id);

    const { purgeBulk } = await import("./actions");

    await expect(purgeBulk([area.id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(area.id)).toBe("deleted");
  });
});
