import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { restoreShiftError, restoreShiftGuarded } from "./shift-restore";
import { shiftDefinition } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import { seedLocation, seedShift, seedSite } from "@/lib/test-fixtures";
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
    .select({
      deletedAt: shiftDefinition.deletedAt,
      isActive: shiftDefinition.isActive,
    })
    .from(shiftDefinition)
    .where(eq(shiftDefinition.id, id));
  return row;
}

function restore(actor: ScopeActor, id: string) {
  return db.transaction((tx) => restoreShiftGuarded(tx, actor, id));
}

const NOT_FOUND = { ok: false, message: "Deleted shift not found." };

describe("restoreShiftGuarded", () => {
  test("a soft-deleted shift comes back live and keeps is_active", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    await db
      .update(shiftDefinition)
      .set({ isActive: false })
      .where(eq(shiftDefinition.id, shift.id));

    expect(await restore(SUPERADMIN, shift.id)).toEqual({ ok: true });

    expect(await rowOf(shift.id)).toEqual({ deletedAt: null, isActive: false });
  });

  test("an active shift stays active when restored", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(SUPERADMIN, shift.id)).toEqual({ ok: true });

    expect(await rowOf(shift.id)).toEqual({ deletedAt: null, isActive: true });
  });

  test("an HO restores a deleted shift of their own site", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(site.id), shift.id)).toEqual({ ok: true });
  });

  test("an HO of another site gets not-found and the row stays deleted", async () => {
    const site = await seedSite(cleanup);
    const otherSite = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(otherSite.id), shift.id)).toEqual(NOT_FOUND);
    expect((await rowOf(shift.id)).deletedAt).not.toBeNull();
  });

  test("an HO bound to no site restores nothing", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(hoOf(null), shift.id)).toEqual(NOT_FOUND);
  });

  test("an admin restores a deleted shift of their own location", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(loc.id), shift.id)).toEqual({ ok: true });
  });

  test("an admin of a sibling location gets not-found", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(sibling.id), shift.id)).toEqual(NOT_FOUND);
    expect((await rowOf(shift.id)).deletedAt).not.toBeNull();
  });

  test("an admin bound to no location restores nothing", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(adminOf(null), shift.id)).toEqual(NOT_FOUND);
  });

  test("a shift that is not soft-deleted is refused and left alone", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc);

    expect(await restore(SUPERADMIN, shift.id)).toEqual(NOT_FOUND);
    expect((await rowOf(shift.id)).deletedAt).toBeNull();
  });

  test("an unknown id is refused", async () => {
    expect(await restore(SUPERADMIN, randomUUID())).toEqual(NOT_FOUND);
  });

  test("a deleted location refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id, { deleted: true });
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await restore(SUPERADMIN, shift.id)).toEqual({
      ok: false,
      message: "Location is deleted; restore it first",
    });
    expect((await rowOf(shift.id)).deletedAt).not.toBeNull();
  });

  test("a live shift in the location using the order index refuses the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, {
      deleted: true,
      orderIndex: 2,
    });
    await seedShift(cleanup, loc, { orderIndex: 2 });

    expect(await restore(SUPERADMIN, shift.id)).toEqual({
      ok: false,
      message: "Order is already used by another shift",
    });
    expect((await rowOf(shift.id)).deletedAt).not.toBeNull();
  });

  test("the same order index in another location does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const sibling = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });
    await seedShift(cleanup, sibling, { orderIndex: 2 });

    expect(await restore(SUPERADMIN, shift.id)).toEqual({ ok: true });
  });

  test("another deleted shift with the same order index does not block the restore", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });
    const twin = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });

    expect(await restore(SUPERADMIN, shift.id)).toEqual({ ok: true });
    expect((await rowOf(twin.id)).deletedAt).not.toBeNull();
  });
});

describe("restoreShiftError", () => {
  test("the unique-index error reads as the order-taken text, like the guard", () => {
    expect(restoreShiftError({ code: "23505" })).toBe(
      "Order is already used by another shift",
    );
  });

  test("the code is found through the driver's cause chain", () => {
    expect(restoreShiftError({ cause: { code: "23505" } })).toBe(
      "Order is already used by another shift",
    );
  });

  test("a reference violation reads as the vanished-location text", () => {
    expect(restoreShiftError({ code: "23503" })).toBe(
      "Selected location no longer exists",
    );
  });

  test("anything else is the generic message", () => {
    expect(restoreShiftError(new Error("boom"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
