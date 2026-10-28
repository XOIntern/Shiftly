import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { worker } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAssignment,
  seedLocation,
  seedPosition,
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
    email: `t192-worker-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

async function stateOf(id: string): Promise<"missing" | "deleted" | "live"> {
  const [row] = await db
    .select({ deletedAt: worker.deletedAt })
    .from(worker)
    .where(eq(worker.id, id));
  if (!row) return "missing";
  return row.deletedAt ? "deleted" : "live";
}

// A deleted worker the purge must refuse: a roster assignment names it.
async function seedWorkerWithHistory(loc: {
  id: string;
  siteId: string;
}): Promise<string> {
  const w = await seedWorker(cleanup, loc, { deleted: true });
  const area = await seedWorkArea(cleanup, loc);
  const shift = await seedShift(cleanup, loc);
  const author = await seedUser(cleanup, { role: "superadmin" });
  const plan = await seedRosterPlan(cleanup, loc, { generatedBy: author.id });
  await seedAssignment(cleanup, {
    planId: plan.id,
    loc,
    workerId: w.id,
    workAreaId: area.id,
    shiftId: shift.id,
  });
  return w.id;
}

describe("restoreWorker", () => {
  test("a superadmin brings a deleted worker back and revalidates the list", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreWorker } = await import("./actions");

    expect(await restoreWorker(w.id)).toEqual({ ok: true });
    expect(await stateOf(w.id)).toBe("live");
    expect(revalidated).toContain("/dashboard/workers");
  });

  test("an HO restores a deleted worker of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });
    actor = actorOf("ho", site.id);

    const { restoreWorker } = await import("./actions");

    expect(await restoreWorker(w.id)).toEqual({ ok: true });
  });

  test("an admin restores a deleted worker of their own location only", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const mine = await seedWorker(cleanup, loc, { deleted: true });
    const theirs = await seedWorker(cleanup, sibling, { deleted: true });
    actor = actorOf("admin", site.id, loc.id);

    const { restoreWorker } = await import("./actions");

    expect(await restoreWorker(mine.id)).toEqual({ ok: true });
    expect(await restoreWorker(theirs.id)).toEqual({
      ok: false,
      message: "Deleted worker not found.",
    });
    expect(await stateOf(theirs.id)).toBe("deleted");
  });

  test("an HO never restores another site's deleted worker", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });
    actor = actorOf("ho", otherSite.id);

    const { restoreWorker } = await import("./actions");

    expect(await restoreWorker(w.id)).toEqual({
      ok: false,
      message: "Deleted worker not found.",
    });
    expect(await stateOf(w.id)).toBe("deleted");
  });

  test("a deleted held position refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    actor = actorOf("superadmin");

    const { restoreWorker } = await import("./actions");

    expect(await restoreWorker(w.id)).toEqual({
      ok: false,
      message: "A position this worker holds is deleted; restore it first",
    });
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { restoreWorker } = await import("./actions");

    expect(await restoreWorker("nope")).toEqual({
      ok: false,
      message: "Invalid worker id.",
    });
  });
});

describe("restoreBulk", () => {
  test("restores what it can and reports the rest as skipped", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const clashId = `t192-bulk-clash-${randomUUID()}`;
    const a = await seedWorker(cleanup, loc, { deleted: true });
    const b = await seedWorker(cleanup, loc, { deleted: true });
    const clash = await seedWorker(cleanup, loc, {
      deleted: true,
      employeeId: clashId,
    });
    await seedWorker(cleanup, loc, { employeeId: clashId });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, b.id, clash.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 worker skipped: Employee ID already in use in this location",
    );
    expect(await stateOf(clash.id)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/workers");
  });

  test("an admin's batch never reaches another location's rows", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const mine = await seedWorker(cleanup, loc, { deleted: true });
    const theirs = await seedWorker(cleanup, sibling, { deleted: true });
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
    const a = await seedWorker(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");

    const { restoreBulk } = await import("./actions");
    const result = await restoreBulk([a.id, a.id, "nope"]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(await restoreBulk([])).toEqual({
      ok: false,
      message: "No workers selected.",
    });
  });
});

describe("purgeWorker", () => {
  test("a superadmin deletes a clean deleted worker for good", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeWorker } = await import("./actions");

    expect(await purgeWorker(w.id)).toEqual({ ok: true });
    expect(await stateOf(w.id)).toBe("missing");
    expect(revalidated).toContain("/dashboard/workers");
  });

  test("a worker with roster history is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const id = await seedWorkerWithHistory(loc);
    actor = actorOf("superadmin");

    const { purgeWorker } = await import("./actions");

    expect(await purgeWorker(id)).toEqual({
      ok: false,
      message: "Worker has roster history and cannot be permanently deleted",
    });
    expect(await stateOf(id)).toBe("deleted");
  });

  test("a malformed id is rejected", async () => {
    actor = actorOf("superadmin");

    const { purgeWorker } = await import("./actions");

    expect(await purgeWorker("nope")).toEqual({
      ok: false,
      message: "Invalid worker id.",
    });
  });

  test("an HO and an admin are turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    const { purgeWorker } = await import("./actions");

    actor = actorOf("ho", site.id);
    await expect(purgeWorker(w.id)).rejects.toThrow("NEXT_REDIRECT");
    actor = actorOf("admin", site.id, loc.id);
    await expect(purgeWorker(w.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(w.id)).toBe("deleted");
  });
});

describe("purgeBulk", () => {
  test("deletes what it can and reports history-bound workers as skipped", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const a = await seedWorker(cleanup, loc, { deleted: true });
    const b = await seedWorker(cleanup, loc, { deleted: true });
    const withHistory = await seedWorkerWithHistory(loc);
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([a.id, withHistory, b.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 worker skipped: Worker has roster history and cannot be permanently deleted",
    );
    expect(await stateOf(a.id)).toBe("missing");
    expect(await stateOf(withHistory)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/workers");
  });

  test("a live worker in the selection is skipped, not deleted", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const live = await seedWorker(cleanup, loc);
    const gone = await seedWorker(cleanup, loc, { deleted: true });
    actor = actorOf("superadmin");

    const { purgeBulk } = await import("./actions");
    const result = await purgeBulk([live.id, gone.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe("1 worker skipped: Deleted worker not found.");
    expect(await stateOf(live.id)).toBe("live");
  });

  test("an HO is turned away", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });
    actor = actorOf("ho", site.id);

    const { purgeBulk } = await import("./actions");

    await expect(purgeBulk([w.id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(w.id)).toBe("deleted");
  });
});
