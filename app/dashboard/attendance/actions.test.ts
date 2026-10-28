import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { and, eq, like } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  attendanceRecord,
  auditLog,
  shiftDefinition,
  worker,
} from "@/drizzle/schema";
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
async function workerOf(fx: Base, opts: { deleted?: boolean } = {}) {
  const w = await seedWorker(cleanup, fx.loc, opts);
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

// Corrections and unscheduled rows. Every audited change carries a mandatory
// reason and writes its audit_log row in the same transaction as the change.

async function recordedRow(
  fx: Base,
  workerId: string,
  opts: {
    status?: "present" | "leave" | "sick" | "absent";
    withoutRoster?: boolean;
  } = {},
) {
  return seedAttendance(cleanup, {
    loc: fx.loc,
    workerId,
    workAreaId: fx.area.id,
    shiftId: fx.shift.id,
    withoutRoster: opts.withoutRoster,
    recordedBy: fx.admin.id,
    date: DATE,
    status: opts.status ?? "present",
  });
}

describe("correctAttendance", () => {
  test("changes the status and audits old -> new with the reason, actor and location", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id, { status: "present" });
    const { correctAttendance } = await import("./actions");

    const result = await correctAttendance({
      recordId: rec.id,
      expectedStatus: "present",
      expectedShiftDefinitionId: fx.shift.id,
      status: "sick",
      reason: "  Doctor's note arrived  ",
    });

    expect(result.ok).toBe(true);
    expect((await rowsOf(w.id))[0].status).toBe("sick");
    const audits = await attendanceAuditRows(fx.admin.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "attendance.correct",
      actorId: fx.admin.id,
      siteId: fx.loc.siteId,
      siteLocationId: fx.loc.id,
    });
    expect(audits[0].details).toEqual({
      recordId: rec.id,
      workerId: w.id,
      date: DATE,
      old: { status: "present", shiftDefinitionId: fx.shift.id },
      new: { status: "sick", shiftDefinitionId: fx.shift.id },
      reason: "Doctor's note arrived",
    });
  });

  test("a failed audit insert rolls the update back", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id, { status: "present" });
    // A session whose user row does not exist: the audit_log actor FK fails
    // inside the transaction, after the update has run.
    actor = { ...sessionOf("admin", fx), id: randomUUID() };
    const { correctAttendance } = await import("./actions");

    const result = await correctAttendance({
      recordId: rec.id,
      expectedStatus: "present",
      expectedShiftDefinitionId: fx.shift.id,
      status: "absent",
      reason: "typo",
    });

    expect(result.ok).toBe(false);
    expect((await rowsOf(w.id))[0].status).toBe("present");
    expect(await attendanceAuditRows(actor.id)).toHaveLength(0);
  });

  test("changing only the shift to another live shift works and is audited", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const other = await seedShift(cleanup, fx.loc, { orderIndex: 2 });
    const rec = await recordedRow(fx, w.id);
    const { correctAttendance } = await import("./actions");

    const result = await correctAttendance({
      recordId: rec.id,
      expectedStatus: "present",
      expectedShiftDefinitionId: fx.shift.id,
      shiftDefinitionId: other.id,
      reason: "Swapped with a colleague",
    });

    expect(result.ok).toBe(true);
    const [row] = await rowsOf(w.id);
    expect(row.shiftDefinitionId).toBe(other.id);
    // The rostered shift stays beside it, and a correction never moves the area.
    expect(row.rosteredShiftDefinitionId).toBe(fx.shift.id);
    expect(row.workAreaId).toBe(fx.area.id);
    const [audit] = await attendanceAuditRows(fx.admin.id);
    expect(audit.details).toMatchObject({
      old: { status: "present", shiftDefinitionId: fx.shift.id },
      new: { status: "present", shiftDefinitionId: other.id },
    });
  });

  test("an inactive, soft-deleted or other-location shift is refused", async () => {
    const fx = await base();
    const elsewhere = await base();
    actor = sessionOf("admin", fx);
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id);
    const inactive = await seedShift(cleanup, fx.loc, { orderIndex: 2 });
    const gone = await seedShift(cleanup, fx.loc, {
      orderIndex: 3,
      deleted: true,
    });
    await db
      .update(shiftDefinition)
      .set({ isActive: false })
      .where(eq(shiftDefinition.id, inactive.id));
    const { correctAttendance } = await import("./actions");

    for (const shiftId of [inactive.id, gone.id, elsewhere.shift.id]) {
      expect(
        await correctAttendance({
          recordId: rec.id,
          expectedStatus: "present",
          expectedShiftDefinitionId: fx.shift.id,
          shiftDefinitionId: shiftId,
          reason: "try",
        }),
      ).toEqual({
        ok: false,
        message: "Shift or work area is not available at this location",
      });
    }
    expect((await rowsOf(w.id))[0].shiftDefinitionId).toBe(fx.shift.id);
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(0);
  });

  test("a blank reason, unchanged values and a record of another location are refused", async () => {
    const fx = await base();
    const elsewhere = await base();
    actor = sessionOf("admin", fx);
    const w = await workerOf(fx);
    const stranger = await workerOf(elsewhere);
    const rec = await recordedRow(fx, w.id);
    const foreign = await recordedRow(elsewhere, stranger.id);
    const { correctAttendance } = await import("./actions");
    const seen = {
      expectedStatus: "present" as const,
      expectedShiftDefinitionId: fx.shift.id,
    };

    expect(
      await correctAttendance({
        recordId: rec.id,
        ...seen,
        status: "sick",
        reason: "   ",
      }),
    ).toEqual({ ok: false, message: "A reason is required" });
    expect(
      await correctAttendance({
        recordId: rec.id,
        ...seen,
        status: "sick",
        reason: "",
      }),
    ).toEqual({ ok: false, message: "A reason is required" });
    expect(
      await correctAttendance({
        recordId: rec.id,
        ...seen,
        reason: "no change",
      }),
    ).toEqual({ ok: false, message: "Nothing to change" });
    expect(
      await correctAttendance({
        recordId: rec.id,
        ...seen,
        status: "present",
        shiftDefinitionId: fx.shift.id,
        reason: "same again",
      }),
    ).toEqual({ ok: false, message: "Nothing to change" });
    expect(
      await correctAttendance({
        recordId: foreign.id,
        expectedStatus: "present",
        expectedShiftDefinitionId: elsewhere.shift.id,
        status: "sick",
        reason: "not mine",
      }),
    ).toEqual({ ok: false, message: "Attendance record not found." });

    expect((await rowsOf(w.id))[0].status).toBe("present");
    expect((await rowsOf(stranger.id))[0].status).toBe("present");
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(0);
  });

  test("a row someone else changed meanwhile answers 'Attendance changed meanwhile, reload'", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id, { status: "present" });
    // Another admin corrected it after this one loaded the page.
    await db
      .update(attendanceRecord)
      .set({ status: "sick" })
      .where(eq(attendanceRecord.id, rec.id));
    const { correctAttendance } = await import("./actions");

    const result = await correctAttendance({
      recordId: rec.id,
      expectedStatus: "present",
      expectedShiftDefinitionId: fx.shift.id,
      status: "absent",
      reason: "my view was stale",
    });

    expect(result).toEqual({
      ok: false,
      message: "Attendance changed meanwhile, reload",
    });
    expect((await rowsOf(w.id))[0].status).toBe("sick");
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(0);
  });

  test("an ho and a superadmin are refused", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id);
    const { correctAttendance } = await import("./actions");

    for (const role of ["ho", "superadmin"] as const) {
      actor = sessionOf(role, fx);
      expect(
        await correctAttendance({
          recordId: rec.id,
          expectedStatus: "present",
          expectedShiftDefinitionId: fx.shift.id,
          status: "sick",
          reason: "should not work",
        }),
      ).toEqual({ ok: false, message: "Only admins record attendance" });
    }
    expect((await rowsOf(w.id))[0].status).toBe("present");
  });

  test("a malformed record id is refused", async () => {
    await base();
    const { correctAttendance } = await import("./actions");

    expect(
      await correctAttendance({
        recordId: "nope",
        expectedStatus: "present",
        expectedShiftDefinitionId: randomUUID(),
        status: "sick",
        reason: "x",
      }),
    ).toEqual({ ok: false, message: "Invalid attendance input" });
  });
});

describe("addUnscheduled", () => {
  async function ready() {
    const fx = await base();
    const w = await workerOf(fx);
    return { fx, w };
  }

  const input = (
    fx: Base,
    workerId: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    date: DATE,
    workerId,
    workAreaId: fx.area.id,
    shiftDefinitionId: fx.shift.id,
    status: "present" as const,
    reason: "Covering a sick colleague",
    ...overrides,
  });

  test("creates an unscheduled row and audits it", async () => {
    const { fx, w } = await ready();
    const { addUnscheduled } = await import("./actions");

    const result = await addUnscheduled(input(fx, w.id));

    expect(result.ok).toBe(true);
    const [row] = await rowsOf(w.id);
    expect(row).toMatchObject({
      withoutRoster: true,
      rosteredShiftDefinitionId: null,
      shiftDefinitionId: fx.shift.id,
      workAreaId: fx.area.id,
      status: "present",
      reason: "Covering a sick colleague",
      recordedBy: fx.admin.id,
    });
    const [audit] = await attendanceAuditRows(fx.admin.id);
    expect(audit).toMatchObject({
      action: "attendance.unscheduled.add",
      siteId: fx.loc.siteId,
      siteLocationId: fx.loc.id,
    });
    expect(audit.details).toEqual({
      recordId: row.id,
      workerId: w.id,
      date: DATE,
      shiftDefinitionId: fx.shift.id,
      workAreaId: fx.area.id,
      status: "present",
      reason: "Covering a sick colleague",
    });
  });

  test("a worker who is on that date's roster is refused", async () => {
    const { fx, w } = await ready();
    await roster(fx, [w.id]);
    const { addUnscheduled } = await import("./actions");

    expect(await addUnscheduled(input(fx, w.id))).toEqual({
      ok: false,
      message:
        "Worker is on the roster that day; change the shift on the roster row",
    });
    expect(await rowsOf(w.id)).toHaveLength(0);
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(0);
  });

  test("an inactive, soft-deleted or other-location worker answers 'Worker not found.'", async () => {
    const fx = await base();
    const elsewhere = await base();
    actor = sessionOf("admin", fx);
    const inactive = await workerOf(fx);
    const gone = await workerOf(fx, { deleted: true });
    const stranger = await workerOf(elsewhere);
    await db
      .update(worker)
      .set({ isActive: false })
      .where(eq(worker.id, inactive.id));
    const { addUnscheduled } = await import("./actions");

    for (const id of [inactive.id, gone.id, stranger.id, randomUUID()]) {
      expect(await addUnscheduled(input(fx, id))).toEqual({
        ok: false,
        message: "Worker not found.",
      });
    }
    for (const id of [inactive.id, gone.id, stranger.id]) {
      expect(await rowsOf(id)).toHaveLength(0);
    }
  });

  test("a shift or area that is not selectable at this location is refused", async () => {
    const { fx, w } = await ready();
    const elsewhere = await base();
    actor = sessionOf("admin", fx);
    const goneArea = await seedWorkArea(cleanup, fx.loc, { deleted: true });
    const { addUnscheduled } = await import("./actions");
    const refused = {
      ok: false,
      message: "Shift or work area is not available at this location",
    };

    expect(
      await addUnscheduled(
        input(fx, w.id, { shiftDefinitionId: elsewhere.shift.id }),
      ),
    ).toEqual(refused);
    expect(
      await addUnscheduled(input(fx, w.id, { workAreaId: elsewhere.area.id })),
    ).toEqual(refused);
    expect(
      await addUnscheduled(input(fx, w.id, { workAreaId: goneArea.id })),
    ).toEqual(refused);
    expect(await rowsOf(w.id)).toHaveLength(0);
  });

  test("a blank reason, a future date and an existing record are refused", async () => {
    const { fx, w } = await ready();
    const { addUnscheduled } = await import("./actions");

    expect(await addUnscheduled(input(fx, w.id, { reason: "  " }))).toEqual({
      ok: false,
      message: "A reason is required",
    });
    expect(
      await addUnscheduled(input(fx, w.id, { date: "2999-01-01" })),
    ).toEqual({
      ok: false,
      message: "Cannot record attendance for a future date",
    });
    expect(await rowsOf(w.id)).toHaveLength(0);

    expect((await addUnscheduled(input(fx, w.id))).ok).toBe(true);
    expect(await addUnscheduled(input(fx, w.id))).toEqual({
      ok: false,
      message: "Already recorded, reload",
    });
    expect(await rowsOf(w.id)).toHaveLength(1);
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(1);
  });

  test("an ho and a superadmin are refused", async () => {
    const { fx, w } = await ready();
    const { addUnscheduled } = await import("./actions");

    for (const role of ["ho", "superadmin"] as const) {
      actor = sessionOf(role, fx);
      expect(await addUnscheduled(input(fx, w.id))).toEqual({
        ok: false,
        message: "Only admins record attendance",
      });
    }
    expect(await rowsOf(w.id)).toHaveLength(0);
  });
});

describe("removeUnscheduled", () => {
  test("deletes an unscheduled row and audits it with a snapshot of the row", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id, {
      withoutRoster: true,
      status: "sick",
    });
    const { removeUnscheduled } = await import("./actions");

    const result = await removeUnscheduled({
      recordId: rec.id,
      reason: "Entered for the wrong worker",
    });

    expect(result.ok).toBe(true);
    expect(await rowsOf(w.id)).toHaveLength(0);
    const [audit] = await attendanceAuditRows(fx.admin.id);
    expect(audit).toMatchObject({
      action: "attendance.unscheduled.remove",
      siteId: fx.loc.siteId,
      siteLocationId: fx.loc.id,
    });
    expect(audit.details).toMatchObject({
      recordId: rec.id,
      reason: "Entered for the wrong worker",
      snapshot: {
        id: rec.id,
        workerId: w.id,
        date: DATE,
        status: "sick",
        withoutRoster: true,
        rosteredShiftDefinitionId: null,
        shiftDefinitionId: fx.shift.id,
        workAreaId: fx.area.id,
        recordedBy: fx.admin.id,
      },
    });
  });

  test("a roster row cannot be removed and survives", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id);
    const { removeUnscheduled } = await import("./actions");

    expect(
      await removeUnscheduled({ recordId: rec.id, reason: "oops" }),
    ).toEqual({ ok: false, message: "Only unscheduled rows can be removed" });
    expect(await rowsOf(w.id)).toHaveLength(1);
    expect(await attendanceAuditRows(fx.admin.id)).toHaveLength(0);
  });

  test("a blank reason, a malformed id and a record of another location are refused", async () => {
    const fx = await base();
    const elsewhere = await base();
    actor = sessionOf("admin", fx);
    const w = await workerOf(fx);
    const stranger = await workerOf(elsewhere);
    const rec = await recordedRow(fx, w.id, { withoutRoster: true });
    const foreign = await recordedRow(elsewhere, stranger.id, {
      withoutRoster: true,
    });
    const { removeUnscheduled } = await import("./actions");

    expect(await removeUnscheduled({ recordId: rec.id, reason: " " })).toEqual({
      ok: false,
      message: "A reason is required",
    });
    expect(await removeUnscheduled({ recordId: "nope", reason: "x" })).toEqual({
      ok: false,
      message: "Invalid attendance input",
    });
    expect(
      await removeUnscheduled({ recordId: foreign.id, reason: "not mine" }),
    ).toEqual({ ok: false, message: "Attendance record not found." });
    expect(await rowsOf(w.id)).toHaveLength(1);
    expect(await rowsOf(stranger.id)).toHaveLength(1);
  });

  test("an ho and a superadmin are refused", async () => {
    const fx = await base();
    const w = await workerOf(fx);
    const rec = await recordedRow(fx, w.id, { withoutRoster: true });
    const { removeUnscheduled } = await import("./actions");

    for (const role of ["ho", "superadmin"] as const) {
      actor = sessionOf(role, fx);
      expect(
        await removeUnscheduled({ recordId: rec.id, reason: "should not work" }),
      ).toEqual({ ok: false, message: "Only admins record attendance" });
    }
    expect(await rowsOf(w.id)).toHaveLength(1);
  });
});
