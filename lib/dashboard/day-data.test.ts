import "dotenv/config";
import { describe, expect, test } from "bun:test";

import type { RecordInput } from "../../types/attendance";
import { installCleanup, type Cleanup } from "../test-cleanup";
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
} from "../test-fixtures";
import {
  dayKey,
  deriveAttendanceBacklog,
  deriveDay,
  loadDayInputs,
  pickLatestPlans,
} from "./day-data";

const cleanup = installCleanup();

// 2026-01-05 is the Monday of the seeders' default week; the 7th is its
// Wednesday.
const DATE = "2026-01-07";

const record = (overrides: Partial<RecordInput>): RecordInput => ({
  id: "r",
  workerId: "w",
  shiftDefId: "s1",
  workAreaId: "a1",
  status: "present",
  withoutRoster: false,
  rosteredShiftDefId: "s1",
  reason: null,
  ...overrides,
});

describe("pickLatestPlans", () => {
  test("keeps the highest version of a week", () => {
    const picked = pickLatestPlans([
      { id: "v1", siteLocationId: "L", weekStart: "2026-01-05", version: 1 },
      { id: "v2", siteLocationId: "L", weekStart: "2026-01-05", version: 2 },
    ]);

    expect(picked.get("L|2026-01-05")).toBe("v2");
    expect(picked.size).toBe(1);
  });

  test("keeps different weeks and locations apart", () => {
    const picked = pickLatestPlans([
      { id: "a", siteLocationId: "L", weekStart: "2026-01-05", version: 2 },
      { id: "b", siteLocationId: "L", weekStart: "2026-01-12", version: 1 },
      { id: "c", siteLocationId: "M", weekStart: "2026-01-05", version: 1 },
    ]);

    expect(picked.get("L|2026-01-05")).toBe("a");
    expect(picked.get("L|2026-01-12")).toBe("b");
    expect(picked.get("M|2026-01-05")).toBe("c");
  });
});

describe("deriveDay", () => {
  test("splits scheduled from unscheduled and counts the present scheduled", () => {
    const summary = deriveDay({
      roster: [
        { workerId: "w1", workAreaId: "a1", shiftDefId: "s1" },
        { workerId: "w2", workAreaId: "a1", shiftDefId: "s1" },
      ],
      records: [
        record({ id: "r1", workerId: "w1", status: "present" }),
        record({
          id: "r3",
          workerId: "w3",
          status: "absent",
          withoutRoster: true,
          rosteredShiftDefId: null,
        }),
      ],
    });

    expect(summary).toEqual({
      scheduled: 2,
      presentScheduled: 1,
      present: 1,
      leave: 0,
      sick: 0,
      absent: 1,
      unrecorded: 1,
      unscheduled: 1,
    });
  });

  test("an unscheduled present is present but not a present scheduled", () => {
    const summary = deriveDay({
      roster: [],
      records: [
        record({
          workerId: "w1",
          status: "present",
          withoutRoster: true,
          rosteredShiftDefId: null,
        }),
      ],
    });

    expect(summary.present).toBe(1);
    expect(summary.presentScheduled).toBe(0);
    expect(summary.scheduled).toBe(0);
    expect(summary.unscheduled).toBe(1);
  });

  test("an empty day is all zeros", () => {
    expect(deriveDay({ roster: [], records: [] })).toEqual({
      scheduled: 0,
      presentScheduled: 0,
      present: 0,
      leave: 0,
      sick: 0,
      absent: 0,
      unrecorded: 0,
      unscheduled: 0,
    });
  });
});

describe("deriveAttendanceBacklog", () => {
  test("counts the days with unrecorded rows and names the oldest", () => {
    expect(
      deriveAttendanceBacklog([
        { date: "2026-01-05", unrecorded: 0 },
        { date: "2026-01-06", unrecorded: 2 },
        { date: "2026-01-07", unrecorded: 1 },
      ]),
    ).toEqual({ count: 2, oldest: "2026-01-06" });
  });

  test("the oldest does not depend on the order of the days", () => {
    expect(
      deriveAttendanceBacklog([
        { date: "2026-01-07", unrecorded: 1 },
        { date: "2026-01-06", unrecorded: 2 },
      ]),
    ).toEqual({ count: 2, oldest: "2026-01-06" });
  });

  test("no unrecorded rows means no backlog", () => {
    expect(
      deriveAttendanceBacklog([
        { date: "2026-01-05", unrecorded: 0 },
        { date: "2026-01-06", unrecorded: 0 },
      ]),
    ).toEqual({ count: 0, oldest: null });
  });
});

async function base(c: Cleanup) {
  const s = await seedSite(c);
  const loc = await seedLocation(c, s.id);
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

describe("loadDayInputs", () => {
  test("a draft weekly plan contributes no rows", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const draft = await seedRosterPlan(cleanup, fx.loc, { status: "draft" });
    await rostered(fx, draft, w.id);

    const inputs = await loadDayInputs([{ locationId: fx.loc.id, date: DATE }]);

    expect(inputs.get(dayKey(fx.loc.id, DATE))?.roster).toEqual([]);
  });

  test("of two published versions only the higher one's rows appear", async () => {
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

    const inputs = await loadDayInputs([{ locationId: fx.loc.id, date: DATE }]);
    const roster = inputs.get(dayKey(fx.loc.id, DATE))!.roster;

    expect(roster).toEqual([
      { workerId: w2.id, workAreaId: fx.area.id, shiftDefId: fx.shift.id },
    ]);
  });

  test("a draft daily plan does contribute", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const daily = await seedRosterPlan(cleanup, fx.loc, {
      requestDate: DATE,
      status: "draft",
    });
    await rostered(fx, daily, w.id);

    const inputs = await loadDayInputs([{ locationId: fx.loc.id, date: DATE }]);

    expect(
      workerIds(inputs.get(dayKey(fx.loc.id, DATE))!.roster),
    ).toEqual([w.id]);
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

    const inputs = await loadDayInputs([{ locationId: fx.loc.id, date: DATE }]);
    const roster = inputs.get(dayKey(fx.loc.id, DATE))!.roster;

    expect(roster).toHaveLength(1);
    expect(roster[0].shiftDefId).toBe(fx.shift.id);
  });

  test("records come by location and date", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const rec = await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: w.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
      date: DATE,
      status: "sick",
    });
    await seedAttendance(cleanup, {
      loc: fx.loc,
      workerId: w.id,
      workAreaId: fx.area.id,
      shiftId: fx.shift.id,
      recordedBy: fx.admin.id,
      date: "2026-01-08",
    });

    const inputs = await loadDayInputs([{ locationId: fx.loc.id, date: DATE }]);
    const records = inputs.get(dayKey(fx.loc.id, DATE))!.records;

    expect(records).toEqual([
      {
        id: rec.id,
        workerId: w.id,
        shiftDefId: fx.shift.id,
        workAreaId: fx.area.id,
        status: "sick",
        withoutRoster: false,
        rosteredShiftDefId: fx.shift.id,
        reason: null,
      },
    ]);
  });

  test("many locations and dates in one call, each entry only its own rows", async () => {
    const a = await base(cleanup);
    const b = await base(cleanup);
    const wa = await seedWorker(cleanup, a.loc);
    const wb = await seedWorker(cleanup, b.loc);
    const planA = await seedRosterPlan(cleanup, a.loc, { status: "published" });
    const planB = await seedRosterPlan(cleanup, b.loc, { status: "published" });
    const nextA = await seedRosterPlan(cleanup, a.loc, {
      status: "published",
      weekStart: "2026-01-12",
    });
    await rostered(a, planA, wa.id, DATE);
    await rostered(b, planB, wb.id, "2026-01-08");
    await rostered(a, nextA, wa.id, "2026-01-13");
    await seedAttendance(cleanup, {
      loc: b.loc,
      workerId: wb.id,
      workAreaId: b.area.id,
      shiftId: b.shift.id,
      recordedBy: b.admin.id,
      date: "2026-01-08",
    });

    const inputs = await loadDayInputs([
      { locationId: a.loc.id, date: DATE },
      { locationId: b.loc.id, date: "2026-01-08" },
      { locationId: a.loc.id, date: "2026-01-13" },
      { locationId: b.loc.id, date: DATE },
    ]);

    expect(inputs.size).toBe(4);
    expect(workerIds(inputs.get(dayKey(a.loc.id, DATE))!.roster)).toEqual([
      wa.id,
    ]);
    expect(inputs.get(dayKey(a.loc.id, DATE))!.records).toEqual([]);
    expect(workerIds(inputs.get(dayKey(b.loc.id, "2026-01-08"))!.roster)).toEqual(
      [wb.id],
    );
    expect(inputs.get(dayKey(b.loc.id, "2026-01-08"))!.records).toHaveLength(1);
    expect(workerIds(inputs.get(dayKey(a.loc.id, "2026-01-13"))!.roster)).toEqual(
      [wa.id],
    );
    // b has nothing on the 7th and a's rows on other dates never cross over.
    expect(inputs.get(dayKey(b.loc.id, DATE))).toEqual({
      roster: [],
      records: [],
    });
  });

  test("an unrequested date is not in the map", async () => {
    const fx = await base(cleanup);
    const w = await seedWorker(cleanup, fx.loc);
    const weekly = await seedRosterPlan(cleanup, fx.loc, {
      status: "published",
    });
    await rostered(fx, weekly, w.id, DATE);
    await rostered(fx, weekly, w.id, "2026-01-08");

    const inputs = await loadDayInputs([{ locationId: fx.loc.id, date: DATE }]);

    expect([...inputs.keys()]).toEqual([dayKey(fx.loc.id, DATE)]);
  });

  test("a requested day with nothing seeded maps to empty arrays", async () => {
    const fx = await base(cleanup);

    const inputs = await loadDayInputs([{ locationId: fx.loc.id, date: DATE }]);

    expect(inputs.get(dayKey(fx.loc.id, DATE))).toEqual({
      roster: [],
      records: [],
    });
  });

  test("no days means an empty map", async () => {
    expect((await loadDayInputs([])).size).toBe(0);
  });
});
