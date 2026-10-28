import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { shiftDefinition } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAssignment,
  seedLocation,
  seedRosterPlan,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
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
    name: "T192 Actor",
    email: `t192-shift-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

async function stateOf(id: string): Promise<"missing" | "deleted" | "live"> {
  const [row] = await db
    .select({ deletedAt: shiftDefinition.deletedAt })
    .from(shiftDefinition)
    .where(eq(shiftDefinition.id, id));
  if (!row) return "missing";
  return row.deletedAt ? "deleted" : "live";
}

// A deleted shift the purge must refuse: a roster assignment names it.
async function seedShiftWithHistory(loc: {
  id: string;
  siteId: string;
}): Promise<string> {
  const shift = await seedShift(cleanup, loc, { deleted: true, orderIndex: 9 });
  const area = await seedWorkArea(cleanup, loc);
  const w = await seedWorker(cleanup, loc);
  const author = await seedUser(cleanup, { role: "superadmin" });
  const plan = await seedRosterPlan(cleanup, loc, { generatedBy: author.id });
  await seedAssignment(cleanup, {
    planId: plan.id,
    loc,
    workerId: w.id,
    workAreaId: area.id,
    shiftId: shift.id,
  });
  return shift.id;
}

describe("restoreShift", () => {
  test("a superadmin brings a deleted shift back and revalidates the list", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreShift } = await import("./actions");

    expect(await restoreShift(shift.id)).toEqual({ ok: true });
    expect(await stateOf(shift.id)).toBe("live");
    expect(revalidated).toContain("/dashboard/shifts");
  });

  test("an HO restores a deleted shift of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    actor = actorOf("ho", site.id);

    const { restoreShift } = await import("./actions");

    expect(await restoreShift(shift.id)).toEqual({ ok: true });
  });

  test("an admin restores a deleted shift of their own location only", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const mine = await seedShift(cleanup, loc, { deleted: true });
    const theirs = await seedShift(cleanup, sibling, { deleted: true });
    actor = actorOf("admin", site.id, loc.id);

    const { restoreShift } = await import("./actions");

    expect(await restoreShift(mine.id)).toEqual({ ok: true });
    expect(await restoreShift(theirs.id)).toEqual({
      ok: false,
      message: "Deleted shift not found.",
    });
    expect(await stateOf(theirs.id)).toBe("deleted");
  });

  test("an HO never restores another site's deleted shift", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    actor = actorOf("ho", otherSite.id);

    const { restoreShift } = await import("./actions");

    expect(await restoreShift(shift.id)).toEqual({
      ok: false,
      message: "Deleted shift not found.",
    });
    expect(await stateOf(shift.id)).toBe("deleted");
  });

  test("a taken order index is refused with the order-taken message", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });
    await seedShift(cleanup, loc, { orderIndex: 2 });
    actor = actorOf("superadmin");

    const { restoreShift } = await import("./actions");

    expect(await restoreShift(shift.id)).toEqual({
      ok: false,
      message: "Order is already used by another shift",
    });
    expect(await stateOf(shift.id)).toBe("deleted");
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { restoreShift } = await import("./actions");

    expect(await restoreShift("nope")).toEqual({
      ok: false,
      message: "Invalid shift id.",
    });
  });
});

describe("restoreBulk", () => {
  test("restores what it can and reports the rest as skipped", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const a = await seedShift(cleanup, loc, { deleted: true, orderIndex: 1 });
    const b = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });
    const clash = await seedShift(cleanup, loc, { deleted: true, orderIndex: 3 });
    await seedShift(cleanup, loc, { orderIndex: 3 });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, b.id, clash.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 shift skipped: Order is already used by another shift",
    );
    expect(await stateOf(clash.id)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/shifts");
  });

  test("an admin's batch never reaches another location's rows", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const mine = await seedShift(cleanup, loc, { deleted: true });
    const theirs = await seedShift(cleanup, sibling, { deleted: true });
    actor = actorOf("admin", site.id, loc.id);

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([mine.id, theirs.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(await stateOf(theirs.id)).toBe("deleted");
  });

  test("malformed and repeated ids are dropped; nothing valid is an error", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const a = await seedShift(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, a.id, "nope"]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(await restoreBulk([])).toEqual({
      ok: false,
      message: "No shifts selected.",
    });
  });
});

describe("purgeShift", () => {
  test("a superadmin deletes a clean deleted shift for good", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeShift } = await import("./actions");

    expect(await purgeShift(shift.id)).toEqual({ ok: true });
    expect(await stateOf(shift.id)).toBe("missing");
    expect(revalidated).toContain("/dashboard/shifts");
  });

  test("a shift with roster history is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const id = await seedShiftWithHistory(loc);
    actor = actorOf("superadmin");

    const { purgeShift } = await import("./actions");

    expect(await purgeShift(id)).toEqual({
      ok: false,
      message: "Shift has roster history and cannot be permanently deleted",
    });
    expect(await stateOf(id)).toBe("deleted");
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { purgeShift } = await import("./actions");

    expect(await purgeShift("nope")).toEqual({
      ok: false,
      message: "Invalid shift id.",
    });
  });

  test("an HO and an admin are turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    const { purgeShift } = await import("./actions");

    actor = actorOf("ho", site.id);
    await expect(purgeShift(shift.id)).rejects.toThrow("NEXT_REDIRECT");
    actor = actorOf("admin", site.id, loc.id);
    await expect(purgeShift(shift.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(shift.id)).toBe("deleted");
  });
});

describe("purgeBulk", () => {
  test("deletes what it can and reports history-bound shifts as skipped", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const a = await seedShift(cleanup, loc, { deleted: true, orderIndex: 1 });
    const b = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });
    const withHistory = await seedShiftWithHistory(loc);
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([a.id, withHistory, b.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 shift skipped: Shift has roster history and cannot be permanently deleted",
    );
    expect(await stateOf(a.id)).toBe("missing");
    expect(await stateOf(withHistory)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/shifts");
  });

  test("a live shift in the selection is skipped, not deleted", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const live = await seedShift(cleanup, loc, { orderIndex: 1 });
    const gone = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });
    actor = actorOf("superadmin");

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([live.id, gone.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe("1 shift skipped: Deleted shift not found.");
    expect(await stateOf(live.id)).toBe("live");
  });

  test("an HO is turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    actor = actorOf("ho", site.id);

    const { purgeBulk } = await import("./actions");

    await expect(purgeBulk([shift.id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(shift.id)).toBe("deleted");
  });
});
