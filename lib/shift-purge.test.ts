import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { purgeShiftGuarded } from "./shift-purge";
import { shiftDefinition } from "../drizzle/schema";
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
  return db.transaction((tx) => purgeShiftGuarded(tx, id));
}

async function exists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: shiftDefinition.id })
    .from(shiftDefinition)
    .where(eq(shiftDefinition.id, id));
  return rows.length === 1;
}

describe("purgeShiftGuarded", () => {
  test("a shift that is not soft-deleted is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc);

    expect(await purge(shift.id)).toEqual({
      ok: false,
      message: "Deleted shift not found.",
    });
    expect(await exists(shift.id)).toBe(true);
  });

  test("an unknown id is refused", async () => {
    expect(await purge(randomUUID())).toEqual({
      ok: false,
      message: "Deleted shift not found.",
    });
  });

  test("a clean deleted shift is removed", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });

    expect(await purge(shift.id)).toEqual({ ok: true });
    expect(await exists(shift.id)).toBe(false);
  });

  test("purging one shift leaves the location's other shifts alone", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true, orderIndex: 1 });
    const other = await seedShift(cleanup, loc, { deleted: true, orderIndex: 2 });

    expect(await purge(shift.id)).toEqual({ ok: true });
    expect(await exists(other.id)).toBe(true);
  });

  test("a roster assignment is history: refused and the shift stays", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
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

    expect(await purge(shift.id)).toEqual({
      ok: false,
      message: "Shift has roster history and cannot be permanently deleted",
    });
    expect(await exists(shift.id)).toBe(true);
  });

  test("a request line is history: refused and the shift stays", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    const pos = await seedPosition(cleanup, site.id);
    const area = await seedWorkArea(cleanup, loc, { positionIds: [pos.id] });
    const author = await seedUser(cleanup, { role: "superadmin" });
    const request = await seedMpRequest(cleanup, loc, { createdBy: author.id });
    await seedRequestLine(cleanup, {
      requestId: request.id,
      loc,
      workAreaId: area.id,
      shiftId: shift.id,
      positionId: pos.id,
    });

    expect(await purge(shift.id)).toEqual({
      ok: false,
      message: "Shift has request history and cannot be permanently deleted",
    });
    expect(await exists(shift.id)).toBe(true);
  });

  const ATTENDANCE =
    "Shift has attendance history and cannot be permanently deleted";

  test("an attendance record on the worked shift is history: refused and the shift stays", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const shift = await seedShift(cleanup, loc, { deleted: true });
    const area = await seedWorkArea(cleanup, loc);
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

    expect(await purge(shift.id)).toEqual({ ok: false, message: ATTENDANCE });
    expect(await exists(shift.id)).toBe(true);
  });

  test("a record that names the shift only as the rostered one is history too", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const rostered = await seedShift(cleanup, loc, {
      deleted: true,
      orderIndex: 1,
    });
    const worked = await seedShift(cleanup, loc, { orderIndex: 2 });
    const area = await seedWorkArea(cleanup, loc);
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
      shiftId: worked.id,
      rosteredShiftId: rostered.id,
      recordedBy: admin.id,
    });

    expect(await purge(rostered.id)).toEqual({ ok: false, message: ATTENDANCE });
    expect(await exists(rostered.id)).toBe(true);
  });
});
