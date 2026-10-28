import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";

import { db } from "@/lib/db";
import { attendanceRecord, auditLog } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import type { LocationTimezone } from "@/types/timezone";
import { installCleanup } from "@/lib/test-cleanup";
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
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

// The actions resolve their actor through requireUser — swapped for a stub so
// the real server actions run against the test database. The mock swaps the
// WHOLE module across bun's single test process, so every export other suites
// may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test: only revalidatePath is replaced,
// the real exports stay for suites that run after this one.
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

// A Wednesday of a week well in the past, so "not a future date" holds
// without touching the clock.
const DATE = "2026-01-07";

afterEach(() => setSystemTime());

function sessionOf(
  role: SessionUser["role"],
  fx: { site: { id: string }; loc: { id: string }; admin: { id: string } },
): SessionUser {
  return {
    id: fx.admin.id,
    name: "T Attendance Actor",
    email: `t-att-${fx.admin.id}@shiftly.test`,
    role,
    siteId: fx.site.id,
    siteLocationId: role === "admin" ? fx.loc.id : null,
    isActive: true,
  };
}

async function base(timezone?: LocationTimezone) {
  const site = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, site.id, { timezone });
  const area = await seedWorkArea(cleanup, loc);
  const shift = await seedShift(cleanup, loc);
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: site.id,
    siteLocationId: loc.id,
  });
  // Audit rows reference the actor: remove them before the user.
  cleanup.defer(async () => {
    await db.delete(auditLog).where(eq(auditLog.actorId, admin.id));
  });
  const fx = { site, loc, area, shift, admin };
  actor = sessionOf("admin", fx);
  return fx;
}

type Base = Awaited<ReturnType<typeof base>>;

// A worker of the location. Its attendance rows (written by the actions under
// test, not seeded) are removed right before the worker itself: this teardown
// is registered after the worker's own, so it runs first.
async function workerOf(fx: Base) {
  const w = await seedWorker(cleanup, fx.loc);
  cleanup.defer(async () => {
    await db.delete(attendanceRecord).where(eq(attendanceRecord.workerId, w.id));
  });
  return w;
}

// Puts the workers on the published weekly roster of DATE's week.
async function roster(
  fx: Base,
  workerIds: string[],
  opts: { weekStart?: string; date?: string; shiftId?: string } = {},
) {
  const plan = await seedRosterPlan(cleanup, fx.loc, {
    status: "published",
    weekStart: opts.weekStart,
  });
  for (const workerId of workerIds) {
    await seedAssignment(cleanup, {
      planId: plan.id,
      loc: fx.loc,
      workerId,
      workAreaId: fx.area.id,
      shiftId: opts.shiftId ?? fx.shift.id,
      date: opts.date ?? DATE,
    });
  }
}

const rowsOf = (workerId: string) =>
  db
    .select()
    .from(attendanceRecord)
    .where(eq(attendanceRecord.workerId, workerId));

const attendanceAuditRows = (actorId: string) =>
  db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.actorId, actorId), like(auditLog.action, "attendance.%")),
    );

describe("recordAttendance", () => {
  test("inserts the roster's shift, area and rostered shift, and writes no audit row", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { recordAttendance } = await import("./actions");

    const result = await recordAttendance({
      date: DATE,
      workerId: w.id,
      status: "present",
    });

    expect(result.ok).toBe(true);
    const [row] = await rowsOf(w.id);
    expect(row).toMatchObject({
      siteLocationId: fx.loc.id,
      siteId: fx.loc.siteId,
      date: DATE,
      shiftDefinitionId: fx.shift.id,
      workAreaId: fx.area.id,
      rosteredShiftDefinitionId: fx.shift.id,
      status: "present",
      withoutRoster: false,
      reason: null,
      recordedBy: fx.admin.id,
    });
    // The first recording of an unrecorded row is not a correction.
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(0);
  });

  test("a second call for the same worker and date answers 'Already recorded, reload'", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { recordAttendance } = await import("./actions");

    await recordAttendance({ date: DATE, workerId: w.id, status: "present" });
    const again = await recordAttendance({
      date: DATE,
      workerId: w.id,
      status: "sick",
    });

    expect(again).toEqual({ ok: false, message: "Already recorded, reload" });
    const rows = await rowsOf(w.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("present");
  });

  test("a worker who is not on the roster that day is refused", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const { recordAttendance } = await import("./actions");

    const result = await recordAttendance({
      date: DATE,
      workerId: w.id,
      status: "present",
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Worker is not on the roster that day; add an unscheduled row instead",
    });
    expect(await rowsOf(w.id)).toHaveLength(0);
  });

  test("a worker of another location is refused and nothing is written", async () => {
    const fx = await base();
    const elsewhere = await base();
    const stranger = await workerOf(elsewhere);
    await roster(elsewhere, [stranger.id]);
    actor = sessionOf("admin", fx);
    const { recordAttendance } = await import("./actions");

    const result = await recordAttendance({
      date: DATE,
      workerId: stranger.id,
      status: "present",
    });

    expect(result.ok).toBe(false);
    expect(await rowsOf(stranger.id)).toHaveLength(0);
  });

  test("a malformed date, an impossible date and an unknown status are refused", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { recordAttendance } = await import("./actions");
    const invalid = { ok: false, message: "Invalid attendance input" };

    expect(
      await recordAttendance({ date: "07-01-2026", workerId: w.id, status: "present" }),
    ).toEqual(invalid);
    expect(
      await recordAttendance({ date: "2026-02-30", workerId: w.id, status: "present" }),
    ).toEqual(invalid);
    expect(
      await recordAttendance({
        date: DATE,
        workerId: w.id,
        status: "late" as never,
      }),
    ).toEqual(invalid);
    expect(
      await recordAttendance({
        date: DATE,
        workerId: "not-a-uuid",
        status: "present",
      }),
    ).toEqual(invalid);
    expect(await rowsOf(w.id)).toHaveLength(0);
  });

  test("an ho and a superadmin are refused", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { recordAttendance } = await import("./actions");

    for (const role of ["ho", "superadmin"] as const) {
      actor = sessionOf(role, fx);
      expect(
        await recordAttendance({ date: DATE, workerId: w.id, status: "present" }),
      ).toEqual({ ok: false, message: "Only admins record attendance" });
    }
    expect(await rowsOf(w.id)).toHaveLength(0);
  });

  describe("the future-date guard follows the location's zone", () => {
    // 16:30 UTC on the 29th is 23:30 in WIB but already the 30th in WITA/WIT.
    const NOW = new Date("2026-10-29T16:30:00Z");
    const NEXT = "2026-10-30";
    const WEEK = "2026-10-26";

    test("a Jakarta location refuses the 30th", async () => {
      const fx = await base("Asia/Jakarta");
      const w = await workerOf(fx);
      await roster(fx, [w.id], { weekStart: WEEK, date: NEXT });
      const { recordAttendance } = await import("./actions");
      setSystemTime(NOW);

      const result = await recordAttendance({
        date: NEXT,
        workerId: w.id,
        status: "present",
      });

      expect(result).toEqual({
        ok: false,
        message: "Cannot record attendance for a future date",
      });
      expect(await rowsOf(w.id)).toHaveLength(0);
    });

    test("a Makassar location records the 30th", async () => {
      const fx = await base("Asia/Makassar");
      const w = await workerOf(fx);
      await roster(fx, [w.id], { weekStart: WEEK, date: NEXT });
      const { recordAttendance } = await import("./actions");
      setSystemTime(NOW);

      const result = await recordAttendance({
        date: NEXT,
        workerId: w.id,
        status: "present",
      });

      expect(result.ok).toBe(true);
      expect(await rowsOf(w.id)).toHaveLength(1);
    });
  });
});

describe("bulkRecord", () => {
  test("records the unrecorded rostered workers and leaves a recorded row alone", async () => {
    const fx = await base();
    const [a, b, c] = [await workerOf(fx), await workerOf(fx), await workerOf(fx)];
    await roster(fx, [a.id, b.id, c.id]);
    await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: c.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
      date: DATE,
      status: "sick",
    });
    const { bulkRecord } = await import("./actions");

    const result = await bulkRecord({
      date: DATE,
      workerIds: [a.id, b.id, c.id],
      status: "present",
    });

    expect(result).toMatchObject({ ok: true, applied: 2, blocked: 1 });
    expect((await rowsOf(a.id))[0]).toMatchObject({
      status: "present",
      shiftDefinitionId: fx.shift.id,
      rosteredShiftDefinitionId: fx.shift.id,
      withoutRoster: false,
      recordedBy: fx.admin.id,
    });
    expect((await rowsOf(b.id))[0].status).toBe("present");
    expect((await rowsOf(c.id))[0].status).toBe("sick");
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(0);
  });

  test("ids that are not on the roster count as blocked and write nothing", async () => {
    const fx = await base();
    const onRoster = await workerOf(fx);
    const off = await workerOf(fx);
    await roster(fx, [onRoster.id]);
    const { bulkRecord } = await import("./actions");

    const result = await bulkRecord({
      date: DATE,
      workerIds: [onRoster.id, off.id, randomUUID()],
      status: "leave",
    });

    expect(result).toMatchObject({ ok: true, applied: 1, blocked: 2 });
    expect(await rowsOf(off.id)).toHaveLength(0);
  });

  test("a worker id of another location is blocked, never written", async () => {
    const fx = await base();
    const elsewhere = await base();
    const stranger = await workerOf(elsewhere);
    await roster(elsewhere, [stranger.id]);
    actor = sessionOf("admin", fx);
    const { bulkRecord } = await import("./actions");

    const result = await bulkRecord({
      date: DATE,
      workerIds: [stranger.id],
      status: "present",
    });

    expect(result).toMatchObject({ ok: true, applied: 0, blocked: 1 });
    expect(await rowsOf(stranger.id)).toHaveLength(0);
  });

  test("a duplicate id is counted once", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { bulkRecord } = await import("./actions");

    const result = await bulkRecord({
      date: DATE,
      workerIds: [w.id, w.id, w.id],
      status: "present",
    });

    expect(result).toMatchObject({ ok: true, applied: 1, blocked: 0 });
    expect(await rowsOf(w.id)).toHaveLength(1);
  });

  test("an empty list and a malformed id are refused", async () => {
    await base();
    const { bulkRecord } = await import("./actions");
    const invalid = { ok: false, message: "Invalid attendance input" };

    expect(
      await bulkRecord({ date: DATE, workerIds: [], status: "present" }),
    ).toEqual(invalid);
    expect(
      await bulkRecord({ date: DATE, workerIds: ["nope"], status: "present" }),
    ).toEqual(invalid);
  });

  test("501 distinct ids are refused and nothing is written", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { bulkRecord } = await import("./actions");

    const ids = [w.id, ...Array.from({ length: 500 }, () => randomUUID())];
    const result = await bulkRecord({
      date: DATE,
      workerIds: ids,
      status: "present",
    });

    expect(result).toEqual({
      ok: false,
      message: "At most 500 rows per bulk entry",
    });
    expect(await rowsOf(w.id)).toHaveLength(0);
  });

  test("exactly 500 distinct ids are accepted", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { bulkRecord } = await import("./actions");

    const ids = [w.id, ...Array.from({ length: 499 }, () => randomUUID())];
    const result = await bulkRecord({
      date: DATE,
      workerIds: ids,
      status: "present",
    });

    expect(result).toMatchObject({ ok: true, applied: 1, blocked: 499 });
  });

  test("an ho and a superadmin are refused", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    await roster(fx, [w.id]);
    const { bulkRecord } = await import("./actions");

    for (const role of ["ho", "superadmin"] as const) {
      actor = sessionOf(role, fx);
      expect(
        await bulkRecord({ date: DATE, workerIds: [w.id], status: "present" }),
      ).toEqual({ ok: false, message: "Only admins record attendance" });
    }
    expect(await rowsOf(w.id)).toHaveLength(0);
  });

  test("a future date is refused", async () => {
    const fx = await base("Asia/Jakarta");
    const w = await workerOf(fx);
    await roster(fx, [w.id], { weekStart: "2026-10-26", date: "2026-10-30" });
    const { bulkRecord } = await import("./actions");
    setSystemTime(new Date("2026-10-29T16:30:00Z"));

    const result = await bulkRecord({
      date: "2026-10-30",
      workerIds: [w.id],
      status: "present",
    });

    expect(result).toEqual({
      ok: false,
      message: "Cannot record attendance for a future date",
    });
    expect(await rowsOf(w.id)).toHaveLength(0);
  });
});
