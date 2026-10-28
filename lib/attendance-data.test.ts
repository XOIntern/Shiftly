import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  attendanceRecord,
  rosterAssignment,
  shiftDefinition,
  workArea,
  worker,
} from "../drizzle/schema";
import { db } from "./db";
import { installCleanup, type Cleanup } from "./test-cleanup";
import {
  seedAssignment,
  seedAttendance,
  seedLocation,
  seedRosterPlan,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
} from "./test-fixtures";
import { loadDayData, loadRosterRowsForDate } from "./attendance-data";
import type { LocationTimezone } from "../types/timezone";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

// 2026-01-05 is the Monday of the seeders' default week; the 7th is its
// Wednesday.
const DATE = "2026-01-07";

async function base(c: Cleanup, timezone?: LocationTimezone) {
  const s = await seedSite(c);
  const loc = await seedLocation(c, s.id, { timezone });
  const area = await seedWorkArea(c, loc);
  const shift = await seedShift(c, loc);
  const admin = await seedUser(c, {
    role: "admin",
    siteId: s.id,
    siteLocationId: loc.id,
  });
  return { site: s, loc, area, shift, admin };
}

type Base = Awaited<ReturnType<typeof base>>;

async function rostered(
  fx: Base,
  plan: { id: string },
  workerId: string,
  date = DATE,
) {
  await seedAssignment(cleanup, {
    planId: plan.id,
    loc: fx.loc,
    workerId,
    workAreaId: fx.area.id,
    shiftId: fx.shift.id,
    date,
  });
}

const workerIds = (rows: { workerId: string }[]) =>
  rows.map((row) => row.workerId).sort();

describe("loadRosterRowsForDate", () => {
  test("a draft weekly plan is not the operative roster", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const draft = await seedRosterPlan(cleanup, fx.loc, { status: "draft" });
    await rostered(fx, draft, w.id);

    expect(await loadRosterRowsForDate(fx.loc.id, DATE)).toEqual([]);
  });

  test("of two published versions of the week only the higher one counts", async () => {
    const fx = await base(cleanup);
    const w1 = await seedWorker(cleanup, fx.loc);
    const w2 = await seedWorker(cleanup, fx.loc);
    const v1 = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
      version: 1,
    });
    const v2 = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
      version: 2,
    });
    await rostered(fx, v1, w1.id);
    await rostered(fx, v2, w2.id);

    const rows = await loadRosterRowsForDate(fx.loc.id, DATE);

    expect(workerIds(rows)).toEqual([w2.id]);
    expect(rows[0]).toEqual({
      workerId: w2.id,
      workAreaId: fx.area.id,
      shiftDefId: fx.shift.id,
    });
  });

  test("a daily plan row counts whatever its status", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const daily = await seedRosterPlan(cleanup, fx.loc, {
      requestDate: DATE,
      status: "draft",
    });
    await rostered(fx, daily, w.id);

    expect(workerIds(await loadRosterRowsForDate(fx.loc.id, DATE))).toEqual([
      w.id,
    ]);
  });

  test("a worker on both the weekly and the daily plan appears once, the weekly row first", async () => {
    const fx = await base(cleanup);
    const other = await seedShift(cleanup, fx.loc, { orderIndex: 2 });
    const w = await seedWorker(cleanup, fx.loc);
    const weekly = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
    });
    const daily = await seedRosterPlan(cleanup, fx.loc, { requestDate: DATE });
    await rostered(fx, weekly, w.id);
    await seedAssignment(cleanup, {
      planId: daily.id,
      loc: fx.loc,
      workerId: w.id,
      workAreaId: fx.area.id,
      shiftId: other.id,
      date: DATE,
    });

    const rows = await loadRosterRowsForDate(fx.loc.id, DATE);

    expect(rows).toHaveLength(1);
    expect(rows[0].shiftDefId).toBe(fx.shift.id);
  });

  test("other locations, other dates and other weeks never appear", async () => {
    const fx = await base(cleanup);
    const elsewhere = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const stranger = await seedWorker(cleanup, elsewhere.loc);
    const weekly = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
    });
    const nextWeek = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
      weekStart: "2026-01-12",
    });
    const foreign = await seedRosterPlan(cleanup, elsewhere.loc, {
      status: "published",
    });
    await rostered(fx, weekly, w.id, "2026-01-08");
    await rostered(fx, nextWeek, w.id, "2026-01-14");
    await rostered(elsewhere, foreign, stranger.id);

    expect(await loadRosterRowsForDate(fx.loc.id, DATE)).toEqual([]);
  });

  test("it runs on the executor it is given", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const weekly = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
    });
    await rostered(fx, weekly, w.id);

    const rows = await db.transaction((tx) =>
      loadRosterRowsForDate(fx.loc.id, DATE, tx),
    );

    expect(workerIds(rows)).toEqual([w.id]);
  });
});

describe("loadDayData", () => {
  test("the location's time zone comes with the data", async () => {
    const fx = await base(cleanup, "Asia/Jayapura");

    expect((await loadDayData(fx.loc.id, DATE)).timezone).toBe("Asia/Jayapura");
  });

  test("an empty day still lists the shifts, areas and candidates", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);

    const data = await loadDayData(fx.loc.id, DATE);

    expect(data.roster).toEqual([]);
    expect(data.records).toEqual([]);
    expect(data.workers).toEqual({});
    expect(data.shifts).toEqual([
      {
        id: fx.shift.id,
        label: fx.shift.label,
        startTime: "06:00",
        endTime: "14:00",
        selectable: true,
      },
    ]);
    expect(data.areas).toEqual([
      { id: fx.area.id, name: fx.area.name, selectable: true },
    ]);
    expect(data.candidates.map((c) => c.id)).toEqual([w.id]);
  });

  test("roster rows and records of the day come with their workers' names", async () => {
    const fx = await base(cleanup);
    const onRoster = await seedWorker(cleanup, fx.loc);
    const recorded = await seedWorker(cleanup, fx.loc);
    const weekly = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
    });
    await rostered(fx, weekly, onRoster.id);
    await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: recorded.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
      date: DATE,
      status: "sick",
      withoutRoster: true,
    });

    const data = await loadDayData(fx.loc.id, DATE);

    expect(workerIds(data.roster)).toEqual([onRoster.id]);
    expect(data.records).toHaveLength(1);
    expect(data.records[0]).toMatchObject({
      workerId: recorded.id,
      shiftDefId: fx.shift.id,
      workAreaId: fx.area.id,
      status: "sick",
      withoutRoster: true,
      rosteredShiftDefId: null,
      reason: null,
    });
    expect(data.workers[onRoster.id]).toEqual({
      employeeId: onRoster.employeeId,
      name: onRoster.name,
    });
    expect(data.workers[recorded.id]).toEqual({
      employeeId: recorded.employeeId,
      name: recorded.name,
    });
  });

  test("records of other dates and other locations stay out", async () => {
    const fx = await base(cleanup);
    const elsewhere = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const stranger = await seedWorker(cleanup, elsewhere.loc);
    await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: w.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
      date: "2026-01-08",
    });
    await seedAttendance(cleanup, {
      loc: elsewhere.loc,
      workerId: stranger.id,
      workAreaId: elsewhere.area.id,
      shiftId: elsewhere.shift.id,
      recordedBy: elsewhere.admin.id,
      date: DATE,
    });

    const data = await loadDayData(fx.loc.id, DATE);

    expect(data.records).toEqual([]);
    expect(data.workers).toEqual({});
  });

  test("a soft-deleted worker, shift and work area on a record keep their labels but are not selectable", async () => {
    const fx = await base(cleanup);
    const gone = await seedWorker(cleanup, fx.loc, { deleted: true });
    const goneShift = await seedShift(cleanup, fx.loc, {
      deleted: true,
      orderIndex: 2,
    });
    const goneArea = await seedWorkArea(cleanup, fx.loc, { deleted: true });
    await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: gone.id,
      workAreaId: goneArea.id,
      shiftId: goneShift.id,
      recordedBy: fx.admin.id,
      date: DATE,
    });

    const data = await loadDayData(fx.loc.id, DATE);

    expect(data.workers[gone.id]).toEqual({
      employeeId: gone.employeeId,
      name: gone.name,
    });
    const shiftOf = (id: string) => data.shifts.find((s) => s.id === id);
    expect(shiftOf(goneShift.id)).toMatchObject({
      label: goneShift.label,
      selectable: false,
    });
    expect(shiftOf(fx.shift.id)?.selectable).toBe(true);
    const areaOf = (id: string) => data.areas.find((a) => a.id === id);
    expect(areaOf(goneArea.id)).toMatchObject({
      name: goneArea.name,
      selectable: false,
    });
    expect(areaOf(fx.area.id)?.selectable).toBe(true);
    // A deleted worker is never offered as an unscheduled candidate.
    expect(data.candidates.map((c) => c.id)).not.toContain(gone.id);
  });

  test("an inactive shift or area is listed but not selectable", async () => {
    const fx = await base(cleanup);
    const idle = await seedShift(cleanup, fx.loc, { orderIndex: 2 });
    const idleArea = await seedWorkArea(cleanup, fx.loc);
    await db
      .update(shiftDefinition)
      .set({ isActive: false })
      .where(eq(shiftDefinition.id, idle.id));
    await db
      .update(workArea)
      .set({ isActive: false })
      .where(eq(workArea.id, idleArea.id));

    const data = await loadDayData(fx.loc.id, DATE);

    expect(data.shifts.find((s) => s.id === idle.id)?.selectable).toBe(false);
    expect(data.areas.find((a) => a.id === idleArea.id)?.selectable).toBe(false);
  });

  test("candidates are the live, active workers of the location only", async () => {
    const fx = await base(cleanup);
    const elsewhere = await base(cleanup);
    const live = await seedWorker(cleanup, fx.loc);
    const inactive = await seedWorker(cleanup, fx.loc);
    await seedWorker(cleanup, fx.loc, { deleted: true });
    await seedWorker(cleanup, elsewhere.loc);
    await db
      .update(worker)
      .set({ isActive: false })
      .where(eq(worker.id, inactive.id));

    const data = await loadDayData(fx.loc.id, DATE);

    expect(data.candidates).toEqual([
      { id: live.id, employeeId: live.employeeId, name: live.name },
    ]);
  });

  test("a day of 200 workers loads with one query per source, not per row", async () => {
    const fx = await base(cleanup);
    const ids = Array.from({ length: 200 }, () => randomUUID());
    // Teardowns run newest first: the records go before the workers they
    // name, and the plan (registered below) before both.
    cleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.siteLocationId, fx.loc.id));
    });
    cleanup.defer(async () => {
      await db.delete(attendanceRecord).where(
        eq(attendanceRecord.siteLocationId, fx.loc.id),
      );
    });
    await db.insert(worker).values(
      ids.map((id, i) => ({
        id,
        siteId: fx.loc.siteId,
        siteLocationId: fx.loc.id,
        employeeId: `T200-${i}-${id}`,
        name: `Bulk worker ${i}`,
      })),
    );
    const weekly = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
    });
    await db.insert(rosterAssignment).values(
      ids.map((workerId) => ({
        planId: weekly.id,
        siteLocationId: fx.loc.id,
        siteId: fx.loc.siteId,
        workerId,
        workAreaId: fx.area.id,
        shiftDefinitionId: fx.shift.id,
        date: DATE,
      })),
    );
    await db.insert(attendanceRecord).values(
      ids.map((workerId) => ({
        siteLocationId: fx.loc.id,
        siteId: fx.loc.siteId,
        workerId,
        date: DATE,
        shiftDefinitionId: fx.shift.id,
        workAreaId: fx.area.id,
        status: "present" as const,
        rosteredShiftDefinitionId: fx.shift.id,
        recordedBy: fx.admin.id,
      })),
    );

    // Read the count before restoring: a restore clears the recorded calls.
    const query = spyOn(db.$client, "query");
    let data: Awaited<ReturnType<typeof loadDayData>>;
    let queries: number;
    try {
      data = await loadDayData(fx.loc.id, DATE);
      queries = query.mock.calls.length;
    } finally {
      query.mockRestore();
    }

    expect(data.roster).toHaveLength(200);
    expect(data.records).toHaveLength(200);
    expect(Object.keys(data.workers)).toHaveLength(200);
    expect(queries).toBeLessThanOrEqual(9);
  });
});
