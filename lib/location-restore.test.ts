import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { restoreLocationGuarded } from "./location-restore";
import { siteLocation, user, workArea } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedLocation,
  seedSite,
  seedUser,
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

async function rowOf(id: string) {
  const [row] = await db
    .select({ deletedAt: siteLocation.deletedAt, isActive: siteLocation.isActive })
    .from(siteLocation)
    .where(eq(siteLocation.id, id));
  return row;
}

function restore(actor: ScopeActor, id: string) {
  return db.transaction((tx) => restoreLocationGuarded(tx, actor, id));
}

const NOT_FOUND = { ok: false, message: "Deleted location not found." };

describe("restoreLocationGuarded", () => {
  test("a soft-deleted location comes back live and keeps is_active", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    await db
      .update(siteLocation)
      .set({ isActive: false })
      .where(eq(siteLocation.id, loc.id));

    expect(await restore(SUPERADMIN, loc.id)).toEqual({ ok: true });

    expect(await rowOf(loc.id)).toEqual({ deletedAt: null, isActive: false });
  });

  test("an active location stays active when restored", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });

    expect(await restore(SUPERADMIN, loc.id)).toEqual({ ok: true });

    expect(await rowOf(loc.id)).toEqual({ deletedAt: null, isActive: true });
  });

  test("an HO restores a deleted location of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });

    expect(await restore(hoOf(site.id), loc.id)).toEqual({ ok: true });
    expect((await rowOf(loc.id)).deletedAt).toBeNull();
  });

  test("an HO of another site gets not-found and the row stays deleted", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });

    expect(await restore(hoOf(otherSite.id), loc.id)).toEqual(NOT_FOUND);
    expect((await rowOf(loc.id)).deletedAt).not.toBeNull();
  });

  test("an HO bound to no site restores nothing", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });

    expect(await restore(hoOf(null), loc.id)).toEqual(NOT_FOUND);
    expect((await rowOf(loc.id)).deletedAt).not.toBeNull();
  });

  test("a location that is not soft-deleted is refused and left alone", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);

    expect(await restore(SUPERADMIN, loc.id)).toEqual(NOT_FOUND);
    expect((await rowOf(loc.id)).deletedAt).toBeNull();
  });

  test("an unknown id is refused", async () => {
    expect(await restore(SUPERADMIN, randomUUID())).toEqual(NOT_FOUND);
  });

  test("a deleted site refuses the restore", async () => {
    const site = await seedSite(cleanup, { deleted: true });
    const loc = await seedLocation(cleanup, site.id, { deleted: true });

    expect(await restore(SUPERADMIN, loc.id)).toEqual({
      ok: false,
      message: "Site is deleted; restore it first",
    });
    expect((await rowOf(loc.id)).deletedAt).not.toBeNull();
  });

  test("a live location in the site with the same name refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const name = `t190-restore-dup-${randomUUID()}`;
    const loc = await seedLocation(cleanup, site.id, { deleted: true, name });
    await seedLocation(cleanup, site.id, { name });

    expect(await restore(SUPERADMIN, loc.id)).toEqual({
      ok: false,
      message: "Location name already exists",
    });
    expect((await rowOf(loc.id)).deletedAt).not.toBeNull();
  });

  test("the same name in another site does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const name = `t190-restore-cross-${randomUUID()}`;
    const loc = await seedLocation(cleanup, site.id, { deleted: true, name });
    await seedLocation(cleanup, otherSite.id, { name });

    expect(await restore(SUPERADMIN, loc.id)).toEqual({ ok: true });
  });

  test("another deleted location with the same name does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const name = `t190-restore-twin-${randomUUID()}`;
    const loc = await seedLocation(cleanup, site.id, { deleted: true, name });
    const twin = await seedLocation(cleanup, site.id, { deleted: true, name });

    expect(await restore(SUPERADMIN, loc.id)).toEqual({ ok: true });
    expect((await rowOf(twin.id)).deletedAt).not.toBeNull();
  });

  test("its soft-deleted children stay deleted", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    const area = await seedWorkArea(cleanup, loc, { deleted: true });
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: site.id,
      siteLocationId: loc.id,
      deleted: true,
    });

    expect(await restore(SUPERADMIN, loc.id)).toEqual({ ok: true });

    const [areaRow] = await db
      .select({ deletedAt: workArea.deletedAt })
      .from(workArea)
      .where(eq(workArea.id, area.id));
    const [userRow] = await db
      .select({ deletedAt: user.deletedAt })
      .from(user)
      .where(eq(user.id, admin.id));
    expect(areaRow.deletedAt).not.toBeNull();
    expect(userRow.deletedAt).not.toBeNull();
  });
});
