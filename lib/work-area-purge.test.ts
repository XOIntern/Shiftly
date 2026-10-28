import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { purgeWorkAreaGuarded } from "./work-area-purge";
import { position, workArea, workAreaPosition } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAssignment,
  seedAttendance,
  seedLocation,
  seedMpRequest,
  seedPosition,
  seedRequestLine,
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
  return db.transaction((tx) => purgeWorkAreaGuarded(tx, id));
}

async function exists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: workArea.id })
    .from(workArea)
    .where(eq(workArea.id, id));
  return rows.length === 1;
}

async function linksOf(areaId: string): Promise<number> {
  const rows = await db
    .select()
    .from(workAreaPosition)
    .where(eq(workAreaPosition.workAreaId, areaId));
  return rows.length;
}

describe("purgeWorkAreaGuarded", () => {
  test("a work area that is not soft-deleted is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc);

    expect(await purge(area.id)).toEqual({
      ok: false,
      message: "Deleted work area not found.",
    });
    expect(await exists(area.id)).toBe(true);
  });

  test("an unknown id is refused", async () => {
    expect(await purge(randomUUID())).toEqual({
      ok: false,
      message: "Deleted work area not found.",
    });
  });

  test("a clean deleted work area is removed with its position links", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await purge(area.id)).toEqual({ ok: true });

    expect(await exists(area.id)).toBe(false);
    expect(await linksOf(area.id)).toBe(0);
    // The position itself is the site's, not the work area's: it stays.
    expect(
      await db.select().from(position).where(eq(position.id, pos.id)),
    ).toHaveLength(1);
  });

  test("it removes only its own links, never a sibling work area's", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    const sibling = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await purge(area.id)).toEqual({ ok: true });

    expect(await exists(sibling.id)).toBe(true);
    expect(await linksOf(sibling.id)).toBe(1);
  });

  test("a roster assignment is history: refused, and the links stay", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    const shift = await seedShift(cleanup, loc);
    const w = await seedWorker(cleanup, loc);
    const author = await seedUser(cleanup, { role: "superadmin" });
    const plan = await seedRosterPlan(cleanup, loc, {
      generatedBy: author.id,
    });
    await seedAssignment(cleanup, {
      planId: plan.id,
      loc,
      workerId: w.id,
      workAreaId: area.id,
      shiftId: shift.id,
    });

    expect(await purge(area.id)).toEqual({
      ok: false,
      message: "Work area has roster history and cannot be permanently deleted",
    });
    expect(await exists(area.id)).toBe(true);
    expect(await linksOf(area.id)).toBe(1);
  });

  test("a request line is history: refused, and the links stay", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
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

    expect(await purge(area.id)).toEqual({
      ok: false,
      message: "Work area has request history and cannot be permanently deleted",
    });
    expect(await exists(area.id)).toBe(true);
    expect(await linksOf(area.id)).toBe(1);
  });

  test("an attendance record is history: refused, and the links stay", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    const shift = await seedShift(cleanup, loc);
    const w = await seedWorker(cleanup, loc);
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

    expect(await purge(area.id)).toEqual({
      ok: false,
      message:
        "Work area has attendance history and cannot be permanently deleted",
    });
    expect(await exists(area.id)).toBe(true);
    expect(await linksOf(area.id)).toBe(1);
  });
});
