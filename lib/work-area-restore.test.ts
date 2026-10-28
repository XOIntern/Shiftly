import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { restoreWorkAreaGuarded } from "./work-area-restore";
import { workArea, workAreaPosition } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedLocation,
  seedPosition,
  seedSite,
  seedWorkArea,
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
    .select({ deletedAt: workArea.deletedAt, isActive: workArea.isActive })
    .from(workArea)
    .where(eq(workArea.id, id));
  return row;
}

function restore(actor: ScopeActor, id: string) {
  return db.transaction((tx) => restoreWorkAreaGuarded(tx, actor, id));
}

const NOT_FOUND = { ok: false, message: "Deleted work area not found." };

describe("restoreWorkAreaGuarded", () => {
  test("a soft-deleted work area comes back live and keeps is_active", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });
    await db
      .update(workArea)
      .set({ isActive: false })
      .where(eq(workArea.id, area.id));

    expect(await restore(SUPERADMIN, area.id)).toEqual({ ok: true });

    expect(await rowOf(area.id)).toEqual({ deletedAt: null, isActive: false });
  });

  test("an active work area stays active when restored", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(SUPERADMIN, area.id)).toEqual({ ok: true });

    expect(await rowOf(area.id)).toEqual({ deletedAt: null, isActive: true });
  });

  test("an HO restores a deleted work area of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(site.id), area.id)).toEqual({ ok: true });
  });

  test("an HO of another site gets not-found and the row stays deleted", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(otherSite.id), area.id)).toEqual(NOT_FOUND);
    expect((await rowOf(area.id)).deletedAt).not.toBeNull();
  });

  test("an HO bound to no site restores nothing", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(null), area.id)).toEqual(NOT_FOUND);
  });

  test("an admin restores a deleted work area of their own location", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(loc.id), area.id)).toEqual({ ok: true });
  });

  test("an admin of a sibling location gets not-found", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(sibling.id), area.id)).toEqual(NOT_FOUND);
    expect((await rowOf(area.id)).deletedAt).not.toBeNull();
  });

  test("an admin bound to no location restores nothing", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(null), area.id)).toEqual(NOT_FOUND);
  });

  test("a work area that is not soft-deleted is refused and left alone", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc);

    expect(await restore(SUPERADMIN, area.id)).toEqual(NOT_FOUND);
    expect((await rowOf(area.id)).deletedAt).toBeNull();
  });

  test("an unknown id is refused", async () => {
    expect(await restore(SUPERADMIN, randomUUID())).toEqual(NOT_FOUND);
  });

  test("a deleted location refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    const area = await seedWorkArea(cleanup, loc, { deleted: true });

    expect(await restore(SUPERADMIN, area.id)).toEqual({
      ok: false,
      message: "Location is deleted; restore it first",
    });
    expect((await rowOf(area.id)).deletedAt).not.toBeNull();
  });

  test("a soft-deleted required position refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await restore(SUPERADMIN, area.id)).toEqual({
      ok: false,
      message: "A position this work area requires is deleted; restore it first",
    });
    expect((await rowOf(area.id)).deletedAt).not.toBeNull();
  });

  test("live required positions do not block the restore, and their links stay", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await restore(SUPERADMIN, area.id)).toEqual({ ok: true });
    expect(
      await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, area.id)),
    ).toHaveLength(1);
  });

  test("a live work area in the location with the same name refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const name = `t191-area-dup-${randomUUID()}`;
    const area = await seedWorkArea(cleanup, loc, { deleted: true, name });
    await seedWorkArea(cleanup, loc, { name });

    expect(await restore(SUPERADMIN, area.id)).toEqual({
      ok: false,
      message: "Work area name already exists",
    });
    expect((await rowOf(area.id)).deletedAt).not.toBeNull();
  });

  test("the same name in another location does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const name = `t191-area-cross-${randomUUID()}`;
    const area = await seedWorkArea(cleanup, loc, { deleted: true, name });
    await seedWorkArea(cleanup, sibling, { name });

    expect(await restore(SUPERADMIN, area.id)).toEqual({ ok: true });
  });

  test("another deleted work area with the same name does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const name = `t191-area-twin-${randomUUID()}`;
    const area = await seedWorkArea(cleanup, loc, { deleted: true, name });
    const twin = await seedWorkArea(cleanup, loc, { deleted: true, name });

    expect(await restore(SUPERADMIN, area.id)).toEqual({ ok: true });
    expect((await rowOf(twin.id)).deletedAt).not.toBeNull();
  });
});
