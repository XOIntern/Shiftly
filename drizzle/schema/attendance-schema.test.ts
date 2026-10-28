import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import {
  seedAttendance,
  seedLocation,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
} from "../../lib/test-fixtures";
import { installCleanup, type Cleanup } from "../../lib/test-cleanup";
import { user } from "./auth-schema";
import { attendanceRecord } from "./attendance-schema";
import { siteLocation } from "./site-schema";
import { shiftDefinition } from "./shift-schema";
import { workArea } from "./work-area-schema";
import { worker } from "./worker-schema";

// DB-level pins for attendance_record: the (worker, date) uniqueness, the
// without_roster <-> rostered shift CHECK, the status enum, the site welds
// (worker pair, shift and work-area triples) and RESTRICT on every parent so
// payroll-basis history can never be pulled out from under. Fixtures come
// from lib/test-fixtures and tear down in afterEach, newest first.

const cleanup = installCleanup();

async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (err) {
    return pgErrorCode(err);
  }
  return undefined;
}

async function base(cleanup: Cleanup) {
  const s = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, s.id);
  const w = await seedWorker(cleanup, loc);
  const shift = await seedShift(cleanup, loc);
  const area = await seedWorkArea(cleanup, loc);
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: s.id,
    siteLocationId: loc.id,
  });
  return { loc, w, shift, area, admin };
}

function rowValues(fx: Awaited<ReturnType<typeof base>>) {
  return {
    siteLocationId: fx.loc.id,
    siteId: fx.loc.siteId,
    workerId: fx.w.id,
    date: "2026-01-05",
    shiftDefinitionId: fx.shift.id,
    workAreaId: fx.area.id,
    status: "present" as const,
    withoutRoster: false,
    rosteredShiftDefinitionId: fx.shift.id,
    recordedBy: fx.admin.id,
  };
}

// Registers the teardown for a row a test inserts directly (the seeder is
// for the valid rows; violations go straight to the table).
function track(id: string) {
  cleanup.defer(async () => {
    await db.delete(attendanceRecord).where(eq(attendanceRecord.id, id));
  });
  return id;
}

describe("attendance_record schema", () => {
  test("a valid row inserts and reads back", async () => {
    const fx = await base(cleanup);
    const { id } = await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: fx.w.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
    });

    const [row] = await db
      .select()
      .from(attendanceRecord)
      .where(eq(attendanceRecord.id, id));
    expect(row.workerId).toBe(fx.w.id);
    expect(row.date).toBe("2026-01-05");
    expect(row.status).toBe("present");
    expect(row.withoutRoster).toBe(false);
    expect(row.rosteredShiftDefinitionId).toBe(fx.shift.id);
    expect(row.reason).toBeNull();
    expect(row.recordedBy).toBe(fx.admin.id);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  test("a second row for the same worker and date fails 23505", async () => {
    const fx = await base(cleanup);
    await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: fx.w.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
    });

    const id = track(randomUUID());
    expect(
      await codeOf(() =>
        db.insert(attendanceRecord).values({ id, ...rowValues(fx) }),
      ),
    ).toBe("23505");
  });

  test("the same worker on another date inserts fine", async () => {
    const fx = await base(cleanup);
    await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: fx.w.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
    });

    const id = track(randomUUID());
    await db
      .insert(attendanceRecord)
      .values({ id, ...rowValues(fx), date: "2026-01-06" });
    expect(
      (await db.select().from(attendanceRecord).where(eq(attendanceRecord.id, id)))
        .length,
    ).toBe(1);
  });

  test("without_roster true with a rostered shift fails 23514", async () => {
    const fx = await base(cleanup);
    const id = track(randomUUID());
    expect(
      await codeOf(() =>
        db
          .insert(attendanceRecord)
          .values({ id, ...rowValues(fx), withoutRoster: true }),
      ),
    ).toBe("23514");
  });

  test("without_roster false without a rostered shift fails 23514", async () => {
    const fx = await base(cleanup);
    const id = track(randomUUID());
    expect(
      await codeOf(() =>
        db.insert(attendanceRecord).values({
          id,
          ...rowValues(fx),
          rosteredShiftDefinitionId: null,
        }),
      ),
    ).toBe("23514");
  });

  test("an unscheduled row (without_roster true, no rostered shift) inserts", async () => {
    const fx = await base(cleanup);
    const { id } = await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: fx.w.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
      withoutRoster: true,
    });
    const [row] = await db
      .select()
      .from(attendanceRecord)
      .where(eq(attendanceRecord.id, id));
    expect(row.withoutRoster).toBe(true);
    expect(row.rosteredShiftDefinitionId).toBeNull();
  });

  test("a shift from another location fails 23503", async () => {
    const fx = await base(cleanup);
    const otherLoc = await seedLocation(cleanup, fx.loc.siteId);
    const foreignShift = await seedShift(cleanup, otherLoc);
    const id = track(randomUUID());
    expect(
      await codeOf(() =>
        db.insert(attendanceRecord).values({
          id,
          ...rowValues(fx),
          shiftDefinitionId: foreignShift.id,
          rosteredShiftDefinitionId: foreignShift.id,
        }),
      ),
    ).toBe("23503");
  });

  test("a work area from another location fails 23503", async () => {
    const fx = await base(cleanup);
    const otherLoc = await seedLocation(cleanup, fx.loc.siteId);
    const foreignArea = await seedWorkArea(cleanup, otherLoc);
    const id = track(randomUUID());
    expect(
      await codeOf(() =>
        db.insert(attendanceRecord).values({
          id,
          ...rowValues(fx),
          workAreaId: foreignArea.id,
        }),
      ),
    ).toBe("23503");
  });

  test("a worker from another site fails 23503", async () => {
    const fx = await base(cleanup);
    const otherSite = await seedSite(cleanup);
    const otherLoc = await seedLocation(cleanup, otherSite.id);
    const foreignWorker = await seedWorker(cleanup, otherLoc);
    const id = track(randomUUID());
    expect(
      await codeOf(() =>
        db.insert(attendanceRecord).values({
          id,
          ...rowValues(fx),
          workerId: foreignWorker.id,
        }),
      ),
    ).toBe("23503");
  });

  test("a status outside the enum fails 22P02", async () => {
    const fx = await base(cleanup);
    const id = track(randomUUID());
    expect(
      await codeOf(() =>
        db.insert(attendanceRecord).values({
          id,
          ...rowValues(fx),
          status: "late" as unknown as "present",
        }),
      ),
    ).toBe("22P02");
  });

  test("every status of the enum is accepted", async () => {
    const fx = await base(cleanup);
    const statuses = ["present", "leave", "sick", "absent"] as const;
    for (const [i, status] of statuses.entries()) {
      const id = track(randomUUID());
      await db.insert(attendanceRecord).values({
        id,
        ...rowValues(fx),
        date: `2026-02-0${i + 1}`,
        status,
      });
    }
  });

  // RESTRICT on every parent: attendance is the payroll basis and is never
  // cascaded away by a delete of what it references. Postgres raises 23001
  // (restrict_violation) for ON DELETE RESTRICT, not the generic 23503 an
  // insert gets from a missing parent (see REFERENCE_CODES in types/db-error).
  describe("RESTRICT", () => {
    const RESTRICT_VIOLATION = "23001";

    async function withRow() {
      const fx = await base(cleanup);
      await seedAttendance(cleanup, {
        loc: fx.loc,
        workerId: fx.w.id,
        workAreaId: fx.area.id,
        shiftId: fx.shift.id,
        recordedBy: fx.admin.id,
      });
      return fx;
    }

    test("deleting the worker is refused", async () => {
      const fx = await withRow();
      expect(
        await codeOf(() => db.delete(worker).where(eq(worker.id, fx.w.id))),
      ).toBe(RESTRICT_VIOLATION);
    });

    test("deleting the shift is refused", async () => {
      const fx = await withRow();
      expect(
        await codeOf(() =>
          db.delete(shiftDefinition).where(eq(shiftDefinition.id, fx.shift.id)),
        ),
      ).toBe(RESTRICT_VIOLATION);
    });

    test("deleting the rostered shift alone is refused", async () => {
      const fx = await base(cleanup);
      const worked = await seedShift(cleanup, fx.loc, { orderIndex: 2 });
      await seedAttendance(cleanup, {
        loc: fx.loc,
        workerId: fx.w.id,
        workAreaId: fx.area.id,
        shiftId: worked.id,
        rosteredShiftId: fx.shift.id,
        recordedBy: fx.admin.id,
      });
      expect(
        await codeOf(() =>
          db.delete(shiftDefinition).where(eq(shiftDefinition.id, fx.shift.id)),
        ),
      ).toBe(RESTRICT_VIOLATION);
    });

    test("deleting the work area is refused", async () => {
      const fx = await withRow();
      expect(
        await codeOf(() => db.delete(workArea).where(eq(workArea.id, fx.area.id))),
      ).toBe(RESTRICT_VIOLATION);
    });

    test("deleting the location is refused", async () => {
      const fx = await withRow();
      expect(
        await codeOf(() =>
          db.delete(siteLocation).where(eq(siteLocation.id, fx.loc.id)),
        ),
      ).toBe(RESTRICT_VIOLATION);
    });

    test("deleting the recorder is refused", async () => {
      const fx = await withRow();
      expect(
        await codeOf(() => db.delete(user).where(eq(user.id, fx.admin.id))),
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});
