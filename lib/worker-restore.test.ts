import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { restoreWorkerGuarded } from "./worker-restore";
import { worker, workerPosition } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedLocation,
  seedPosition,
  seedSite,
  seedWorker,
} from "@/lib/test-fixtures";
import type { ScopeActor } from "@/types/session";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

const SUPERADMIN: ScopeActor = {
  role: "superadmin",
  siteId: null,
  siteLocationId: null,
};

function hoOf(siteId: string | null): ScopeActor {
  return { role: "ho", siteId, siteLocationId: null };
}

function adminOf(siteLocationId: string | null): ScopeActor {
  return { role: "admin", siteId: null, siteLocationId };
}

async function rowOf(id: string) {
  const [row] = await db
    .select({ deletedAt: worker.deletedAt, isActive: worker.isActive })
    .from(worker)
    .where(eq(worker.id, id));
  return row;
}

function restore(actor: ScopeActor, id: string) {
  return db.transaction((tx) => restoreWorkerGuarded(tx, actor, id));
}

const NOT_FOUND = { ok: false, message: "Deleted worker not found." };

describe("restoreWorkerGuarded", () => {
  test("a soft-deleted worker comes back live and keeps is_active", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });
    await db.update(worker).set({ isActive: false }).where(eq(worker.id, w.id));

    expect(await restore(SUPERADMIN, w.id)).toEqual({ ok: true });

    expect(await rowOf(w.id)).toEqual({ deletedAt: null, isActive: false });
  });

  test("an active worker stays active when restored", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(SUPERADMIN, w.id)).toEqual({ ok: true });

    expect(await rowOf(w.id)).toEqual({ deletedAt: null, isActive: true });
  });

  test("an HO restores a deleted worker of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(site.id), w.id)).toEqual({ ok: true });
  });

  test("an HO of another site gets not-found and the row stays deleted", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(otherSite.id), w.id)).toEqual(NOT_FOUND);
    expect((await rowOf(w.id)).deletedAt).not.toBeNull();
  });

  test("an HO bound to no site restores nothing", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(null), w.id)).toEqual(NOT_FOUND);
  });

  test("an admin restores a deleted worker of their own location", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(loc.id), w.id)).toEqual({ ok: true });
  });

  test("an admin of a sibling location gets not-found", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(sibling.id), w.id)).toEqual(NOT_FOUND);
    expect((await rowOf(w.id)).deletedAt).not.toBeNull();
  });

  test("an admin bound to no location restores nothing", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(null), w.id)).toEqual(NOT_FOUND);
  });

  test("a worker that is not soft-deleted is refused and left alone", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const w = await seedWorker(cleanup, loc);

    expect(await restore(SUPERADMIN, w.id)).toEqual(NOT_FOUND);
    expect((await rowOf(w.id)).deletedAt).toBeNull();
  });

  test("an unknown id is refused", async () => {
    expect(await restore(SUPERADMIN, randomUUID())).toEqual(NOT_FOUND);
  });

  test("a deleted location refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    const w = await seedWorker(cleanup, loc, { deleted: true });

    expect(await restore(SUPERADMIN, w.id)).toEqual({
      ok: false,
      message: "Location is deleted; restore it first",
    });
    expect((await rowOf(w.id)).deletedAt).not.toBeNull();
  });

  test("a soft-deleted position the worker holds refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await restore(SUPERADMIN, w.id)).toEqual({
      ok: false,
      message: "A position this worker holds is deleted; restore it first",
    });
    expect((await rowOf(w.id)).deletedAt).not.toBeNull();
  });

  test("live positions do not block the restore, and the links stay", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await restore(SUPERADMIN, w.id)).toEqual({ ok: true });
    expect(
      await db
        .select()
        .from(workerPosition)
        .where(eq(workerPosition.workerId, w.id)),
    ).toHaveLength(1);
  });

  test("a live worker in the location with the same employee id refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const employeeId = `t192-emp-${randomUUID()}`;
    const w = await seedWorker(cleanup, loc, { deleted: true, employeeId });
    await seedWorker(cleanup, loc, { employeeId });

    expect(await restore(SUPERADMIN, w.id)).toEqual({
      ok: false,
      message: "Employee ID already in use in this location",
    });
    expect((await rowOf(w.id)).deletedAt).not.toBeNull();
  });

  test("the same employee id in another location does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const employeeId = `t192-emp-${randomUUID()}`;
    const w = await seedWorker(cleanup, loc, { deleted: true, employeeId });
    await seedWorker(cleanup, sibling, { employeeId });

    expect(await restore(SUPERADMIN, w.id)).toEqual({ ok: true });
  });

  test("another deleted worker with the same employee id does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const employeeId = `t192-emp-${randomUUID()}`;
    const w = await seedWorker(cleanup, loc, { deleted: true, employeeId });
    const twin = await seedWorker(cleanup, loc, { deleted: true, employeeId });

    expect(await restore(SUPERADMIN, w.id)).toEqual({ ok: true });
    expect((await rowOf(twin.id)).deletedAt).not.toBeNull();
  });
});
