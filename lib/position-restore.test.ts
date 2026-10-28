import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { restorePositionGuarded } from "./position-restore";
import { position } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedLocation,
  seedPosition,
  seedSite,
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
    .select({ deletedAt: position.deletedAt, isActive: position.isActive })
    .from(position)
    .where(eq(position.id, id));
  return row;
}

function restore(actor: ScopeActor, id: string) {
  return db.transaction((tx) => restorePositionGuarded(tx, actor, id));
}

const NOT_FOUND = { ok: false, message: "Deleted position not found." };

describe("restorePositionGuarded", () => {
  test("a soft-deleted position comes back live and keeps is_active", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    await db
      .update(position)
      .set({ isActive: false })
      .where(eq(position.id, pos.id));

    expect(await restore(SUPERADMIN, pos.id)).toEqual({ ok: true });

    expect(await rowOf(pos.id)).toEqual({ deletedAt: null, isActive: false });
  });

  test("an active position stays active when restored", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(SUPERADMIN, pos.id)).toEqual({ ok: true });

    expect(await rowOf(pos.id)).toEqual({ deletedAt: null, isActive: true });
  });

  test("an HO restores a deleted position of their own site", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(hoOf(site.id), pos.id)).toEqual({ ok: true });
  });

  test("an HO of another site gets not-found and the row stays deleted", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(hoOf(otherSite.id), pos.id)).toEqual(NOT_FOUND);
    expect((await rowOf(pos.id)).deletedAt).not.toBeNull();
  });

  test("an HO bound to no site restores nothing", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(hoOf(null), pos.id)).toEqual(NOT_FOUND);
    expect((await rowOf(pos.id)).deletedAt).not.toBeNull();
  });

  test("an admin restores a deleted position of their location's site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(adminOf(loc.id), pos.id)).toEqual({ ok: true });
  });

  test("an admin of another site's location gets not-found", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const otherLoc = await seedLocation(cleanup, otherSite.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(adminOf(otherLoc.id), pos.id)).toEqual(NOT_FOUND);
    expect((await rowOf(pos.id)).deletedAt).not.toBeNull();
  });

  test("an admin bound to no location restores nothing", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(adminOf(null), pos.id)).toEqual(NOT_FOUND);
  });

  test("a position that is not soft-deleted is refused and left alone", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id);

    expect(await restore(SUPERADMIN, pos.id)).toEqual(NOT_FOUND);
    expect((await rowOf(pos.id)).deletedAt).toBeNull();
  });

  test("an unknown id is refused", async () => {
    expect(await restore(SUPERADMIN, randomUUID())).toEqual(NOT_FOUND);
  });

  test("a deleted site refuses the restore", async () => {
    const site = await seedSite(cleanup, { deleted: true });
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await restore(SUPERADMIN, pos.id)).toEqual({
      ok: false,
      message: "Site is deleted; restore it first",
    });
    expect((await rowOf(pos.id)).deletedAt).not.toBeNull();
  });

  test("a live position in the site with the same name refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const name = `t191-pos-dup-${randomUUID()}`;
    const pos = await seedPosition(cleanup, site.id, { deleted: true, name });
    await seedPosition(cleanup, site.id, { name });

    expect(await restore(SUPERADMIN, pos.id)).toEqual({
      ok: false,
      message: "Position name already exists",
    });
    expect((await rowOf(pos.id)).deletedAt).not.toBeNull();
  });

  test("the same name in another site does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const name = `t191-pos-cross-${randomUUID()}`;
    const pos = await seedPosition(cleanup, site.id, { deleted: true, name });
    await seedPosition(cleanup, otherSite.id, { name });

    expect(await restore(SUPERADMIN, pos.id)).toEqual({ ok: true });
  });

  test("another deleted position with the same name does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const name = `t191-pos-twin-${randomUUID()}`;
    const pos = await seedPosition(cleanup, site.id, { deleted: true, name });
    const twin = await seedPosition(cleanup, site.id, { deleted: true, name });

    expect(await restore(SUPERADMIN, pos.id)).toEqual({ ok: true });
    expect((await rowOf(twin.id)).deletedAt).not.toBeNull();
  });
});
