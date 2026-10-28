import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { purgeWorkerGuarded } from "./worker-purge";
import { position, worker, workerPosition } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAssignment,
  seedAttendance,
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

function purge(id: string) {
  return db.transaction((tx) => purgeWorkerGuarded(tx, id));
}

async function exists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: worker.id })
    .from(worker)
    .where(eq(worker.id, id));
  return rows.length === 1;
}

async function linksOf(workerId: string): Promise<number> {
  const rows = await db
    .select()
    .from(workerPosition)
    .where(eq(workerPosition.workerId, workerId));
  return rows.length;
}

describe("purgeWorkerGuarded", () => {
  test("a worker that is not soft-deleted is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc);

    expect(await purge(w.id)).toEqual({
      ok: false,
      message: "Deleted worker not found.",
    });
    expect(await exists(w.id)).toBe(true);
  });

  test("an unknown id is refused", async () => {
    expect(await purge(randomUUID())).toEqual({
      ok: false,
      message: "Deleted worker not found.",
    });
  });

  test("a clean deleted worker is removed with its position links", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await purge(w.id)).toEqual({ ok: true });

    expect(await exists(w.id)).toBe(false);
    expect(await linksOf(w.id)).toBe(0);
    // The position is the site's, not the worker's: it stays.
    expect(
      await db.select().from(position).where(eq(position.id, pos.id)),
    ).toHaveLength(1);
  });

  test("it removes only its own links, never another worker's", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    const other = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await purge(w.id)).toEqual({ ok: true });

    expect(await exists(other.id)).toBe(true);
    expect(await linksOf(other.id)).toBe(1);
  });

  test("a single roster assignment is history: refused, and the links stay", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
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

    expect(await purge(w.id)).toEqual({
      ok: false,
      message: "Worker has roster history and cannot be permanently deleted",
    });
    expect(await exists(w.id)).toBe(true);
    expect(await linksOf(w.id)).toBe(1);
  });

  test("an attendance record is history: refused, and the links stay", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    const area = await seedWorkArea(cleanup, loc);
    const shift = await seedShift(cleanup, loc);
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: site.id,
      siteLocationId: loc.id,
    });
    await seedAttendance(cleanup, {
      loc,
      workerId: w.id,
      workAreaId: area.id,
      shiftId: shift.id,
      recordedBy: admin.id,
    });

    expect(await purge(w.id)).toEqual({
      ok: false,
      message: "Worker has attendance history and cannot be permanently deleted",
    });
    expect(await exists(w.id)).toBe(true);
    expect(await linksOf(w.id)).toBe(1);
  });
});
