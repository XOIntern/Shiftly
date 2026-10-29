import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { installCleanup } from "../test-cleanup";
import {
  seedAssignment,
  seedAttendance,
  seedLocation,
  seedMpRequest,
  seedRosterPlan,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
} from "../test-fixtures";
import { clockFor } from "./clock";
import {
  actionItemsFor,
  deriveLocationActions,
  loadActions,
  type ActionsInput,
  type LocationActions,
} from "./actions";

const cleanup = installCleanup();

// Wednesday 2026-01-07, noon in Jakarta: this week is 2026-01-05, next week
// 2026-01-12, and the 7 days before today run from 2025-12-31.
const NOW = new Date("2026-01-07T05:00:00Z");
const THIS_WEEK = "2026-01-05";
const NEXT_WEEK = "2026-01-12";
const DAY_MS = 86_400_000;
const clock = clockFor("Asia/Jakarta", NOW);

const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

type Request = ActionsInput["requests"][number];

const weekly = (status: Request["status"], weekStart: string): Request => ({
  type: "weekly",
  status,
  weekStart,
  createdAt: NOW,
});

const daily = (status: Request["status"]): Request => ({
  type: "daily",
  status,
  weekStart: null,
  createdAt: NOW,
});

const input = (overrides: Partial<ActionsInput> = {}): ActionsInput => ({
  role: "admin",
  location: { id: "L1", name: "Plant", siteName: "Nestle" },
  clock,
  now: NOW,
  plans: [],
  requests: [],
  attendance: null,
  ...overrides,
});

describe("deriveLocationActions", () => {
  test("a weekly draft of next week is listed even when a published plan of that week also exists", () => {
    const actions = deriveLocationActions(
      input({
        plans: [
          { weekStart: NEXT_WEEK, status: "published" },
          { weekStart: NEXT_WEEK, status: "draft" },
        ],
      }),
    );

    expect(actions.weeklyDrafts).toEqual([NEXT_WEEK]);
  });

  test("drafts of this and next week are listed oldest first, once each", () => {
    const actions = deriveLocationActions(
      input({
        plans: [
          { weekStart: NEXT_WEEK, status: "draft" },
          { weekStart: THIS_WEEK, status: "draft" },
          { weekStart: THIS_WEEK, status: "draft" },
        ],
      }),
    );

    expect(actions.weeklyDrafts).toEqual([THIS_WEEK, NEXT_WEEK]);
  });

  test("a draft of an out-of-window week is not listed", () => {
    const actions = deriveLocationActions(
      input({
        plans: [
          { weekStart: "2025-12-29", status: "draft" },
          { weekStart: "2026-01-19", status: "draft" },
        ],
      }),
    );

    expect(actions.weeklyDrafts).toEqual([]);
  });

  test("an approved weekly request with no plan of any status is ready to generate", () => {
    const actions = deriveLocationActions(
      input({
        requests: [
          weekly("approved", NEXT_WEEK),
          weekly("approved", THIS_WEEK),
        ],
      }),
    );

    expect(actions.readyToGenerate).toEqual([THIS_WEEK, NEXT_WEEK]);
  });

  test("a draft or a published plan of that week means it is not ready to generate", () => {
    const actions = deriveLocationActions(
      input({
        requests: [
          weekly("approved", THIS_WEEK),
          weekly("approved", NEXT_WEEK),
        ],
        plans: [
          { weekStart: THIS_WEEK, status: "draft" },
          { weekStart: NEXT_WEEK, status: "published" },
        ],
      }),
    );

    expect(actions.readyToGenerate).toEqual([]);
  });

  test("only approved weekly requests of this or next week are ready to generate", () => {
    const actions = deriveLocationActions(
      input({
        requests: [
          weekly("open", THIS_WEEK),
          weekly("fulfilled", THIS_WEEK),
          weekly("approved", "2026-01-19"),
          daily("approved"),
        ],
      }),
    );

    expect(actions.readyToGenerate).toEqual([]);
  });

  test("oldestAgeDays is 3 for an open daily request created 3 days before now", () => {
    const actions = deriveLocationActions(
      input({
        requests: [
          { ...daily("open"), createdAt: daysBefore(3) },
          { ...daily("open"), createdAt: daysBefore(1) },
        ],
      }),
    );

    expect(actions.openRequests).toEqual({ daily: 2, oldestAgeDays: 3 });
  });

  test("oldestAgeDays is null with no open requests", () => {
    const actions = deriveLocationActions(
      input({ requests: [weekly("approved", THIS_WEEK)] }),
    );

    expect(actions.openRequests).toEqual({ daily: 0, oldestAgeDays: null });
  });

  test("a legacy open weekly request is not counted and does not set the age", () => {
    const actions = deriveLocationActions(
      input({
        requests: [
          { ...weekly("open", THIS_WEEK), createdAt: daysBefore(9) },
          { ...daily("open"), createdAt: daysBefore(2) },
        ],
      }),
    );

    expect(actions.openRequests).toEqual({ daily: 1, oldestAgeDays: 2 });
  });

  test("attendance is today's unrecorded plus the past days that still have unrecorded workers", () => {
    const actions = deriveLocationActions(
      input({
        attendance: {
          todayUnrecorded: 4,
          pastDays: [
            { date: "2026-01-04", unrecorded: 0 },
            { date: "2026-01-05", unrecorded: 2 },
            { date: "2026-01-06", unrecorded: 1 },
          ],
        },
      }),
    );

    expect(actions.attendance).toEqual({
      today: 4,
      incomplete: { count: 2, oldest: "2026-01-05" },
    });
  });

  test("an ho never has ready-to-generate weeks, even with an approved request and no plan", () => {
    const actions = deriveLocationActions(
      input({ role: "ho", requests: [weekly("approved", THIS_WEEK)] }),
    );

    expect(actions.readyToGenerate).toEqual([]);
  });

  test("without attendance input attendance is null", () => {
    expect(deriveLocationActions(input()).attendance).toBeNull();
  });

  test("carries the location identity and its own today", () => {
    expect(deriveLocationActions(input())).toMatchObject({
      locationId: "L1",
      locationName: "Plant",
      siteName: "Nestle",
      today: "2026-01-07",
    });
  });
});

const base = (overrides: Partial<LocationActions> = {}): LocationActions => ({
  locationId: "L1",
  locationName: "Plant",
  siteName: "Nestle",
  today: "2026-01-07",
  attendance: null,
  weeklyDrafts: [],
  readyToGenerate: [],
  openRequests: { daily: 0, oldestAgeDays: null },
  ...overrides,
});

const full = (): LocationActions =>
  base({
    attendance: { today: 12, incomplete: { count: 2, oldest: "2026-01-05" } },
    weeklyDrafts: [NEXT_WEEK],
    readyToGenerate: [THIS_WEEK],
    openRequests: { daily: 2, oldestAgeDays: 3 },
  });

describe("actionItemsFor", () => {
  test("an ho gets drafts and open requests only, the requests as info", () => {
    const items = actionItemsFor([full()], "ho");

    expect(items.map((item) => item.kind)).toEqual(["todo", "info"]);
    expect(items.map((item) => item.href)).toEqual([
      `/dashboard/roster?week=${NEXT_WEEK}&locationId=L1`,
      "/dashboard/requests?status=open&type=daily",
    ]);
    expect(items.every((item) => item.locationName === "Plant")).toBe(true);
  });

  test("an admin gets all five items and the open requests are todo", () => {
    const items = actionItemsFor([full()], "admin");

    expect(items.map((item) => item.href)).toEqual([
      "/dashboard/attendance?location=L1&date=2026-01-07",
      "/dashboard/attendance?location=L1&date=2026-01-05",
      `/dashboard/roster?week=${NEXT_WEEK}&locationId=L1`,
      `/dashboard/roster?week=${THIS_WEEK}&locationId=L1`,
      "/dashboard/requests?status=open&type=daily",
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  test("labels are English and name the counts", () => {
    const labels = actionItemsFor([full()], "admin").map((item) => item.label);

    expect(labels).toEqual([
      "12 workers not recorded today",
      "2 earlier days not fully recorded",
      `Roster draft for week of ${NEXT_WEEK} is not published`,
      `Request for week of ${THIS_WEEK} is ready to generate`,
      "2 daily requests waiting to be filled, oldest 3 days",
    ]);
  });

  test("singular counts read naturally", () => {
    const labels = actionItemsFor(
      [
        base({
          attendance: {
            today: 1,
            incomplete: { count: 1, oldest: "2026-01-06" },
          },
          openRequests: { daily: 1, oldestAgeDays: 0 },
        }),
      ],
      "admin",
    ).map((item) => item.label);

    expect(labels).toEqual([
      "1 worker not recorded today",
      "1 earlier day not fully recorded",
      "1 daily request waiting to be filled, oldest today",
    ]);
  });

  test("the age suffix reads oldest 1 day for a day-old request", () => {
    const [item] = actionItemsFor(
      [base({ openRequests: { daily: 1, oldestAgeDays: 1 } })],
      "ho",
    );

    expect(item.label).toBe(
      "1 daily request waiting to be filled, oldest 1 day",
    );
  });

  test("an ho and an admin read the same request wording with different severity", () => {
    const data = [base({ openRequests: { daily: 2, oldestAgeDays: 0 } })];
    const [forHo] = actionItemsFor(data, "ho");
    const [forAdmin] = actionItemsFor(data, "admin");

    expect(forHo.label).toBe(
      "2 daily requests waiting to be filled, oldest today",
    );
    expect(forAdmin.label).toBe(forHo.label);
    expect(forHo.kind).toBe("info");
    expect(forAdmin.kind).toBe("todo");
    expect(forHo.href).toBe("/dashboard/requests?status=open&type=daily");
  });

  test("the open-requests item is keyed open-requests and absent with none", () => {
    const [item] = actionItemsFor(
      [base({ openRequests: { daily: 1, oldestAgeDays: 0 } })],
      "admin",
    );

    expect(item.key).toBe("L1:open-requests");
    expect(
      actionItemsFor(
        [base({ openRequests: { daily: 0, oldestAgeDays: null } })],
        "admin",
      ),
    ).toEqual([]);
  });

  test("nothing to do yields no items", () => {
    expect(actionItemsFor([base()], "admin")).toEqual([]);
    expect(
      actionItemsFor(
        [
          base({
            attendance: { today: 0, incomplete: { count: 0, oldest: null } },
          }),
        ],
        "admin",
      ),
    ).toEqual([]);
  });

  test("keys are unique across locations", () => {
    const items = actionItemsFor(
      [full(), { ...full(), locationId: "L2", locationName: "Dock" }],
      "admin",
    );

    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
});

type Actor = Parameters<typeof loadActions>[0];

async function world() {
  const s = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, s.id);
  const area = await seedWorkArea(cleanup, loc);
  const shift = await seedShift(cleanup, loc);
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: s.id,
    siteLocationId: loc.id,
  });
  const ho = await seedUser(cleanup, { role: "ho", siteId: s.id });
  return { s, loc, area, shift, admin, ho };
}

type World = Awaited<ReturnType<typeof world>>;

const asActor = (u: World["admin"]): Actor => ({
  role: u.role,
  siteId: u.siteId,
  siteLocationId: u.siteLocationId,
});

describe("loadActions", () => {
  test("an admin sees only their location, today's unrecorded and one incomplete past day", async () => {
    const w = await world();
    const w1 = await seedWorker(cleanup, w.loc);
    const w2 = await seedWorker(cleanup, w.loc);
    const plan = await seedRosterPlan(cleanup, w.loc, {
      status: "published",
      weekStart: THIS_WEEK,
    });
    // Today (Wed): two rostered, one recorded. Monday: rostered and recorded.
    // Tuesday: rostered, nothing recorded.
    const rows: [string, string][] = [
      ["2026-01-07", w1.id],
      ["2026-01-07", w2.id],
      ["2026-01-05", w1.id],
      ["2026-01-06", w1.id],
    ];
    for (const [date, workerId] of rows) {
      await seedAssignment(cleanup, {
        planId: plan.id,
        loc: w.loc,
        workerId,
        workAreaId: w.area.id,
        shiftId: w.shift.id,
        date,
      });
    }
    for (const date of ["2026-01-07", "2026-01-05"]) {
      await seedAttendance(cleanup, {
        loc: w.loc,
        workerId: w1.id,
        workAreaId: w.area.id,
        shiftId: w.shift.id,
        recordedBy: w.admin.id,
        date,
      });
    }
    // Another location's unrecorded roster must not leak in.
    const other = await world();
    const stranger = await seedWorker(cleanup, other.loc);
    const otherPlan = await seedRosterPlan(cleanup, other.loc, {
      status: "published",
      weekStart: THIS_WEEK,
    });
    await seedAssignment(cleanup, {
      planId: otherPlan.id,
      loc: other.loc,
      workerId: stranger.id,
      workAreaId: other.area.id,
      shiftId: other.shift.id,
      date: "2026-01-07",
    });

    const result = await loadActions(asActor(w.admin), NOW);

    expect(result.map((row) => row.locationId)).toEqual([w.loc.id]);
    expect(result[0].today).toBe("2026-01-07");
    expect(result[0].attendance).toEqual({
      today: 1,
      incomplete: { count: 1, oldest: "2026-01-06" },
    });
  });

  test("a past day rostered only by a superseded plan version is not in the backlog", async () => {
    const w = await world();
    const stale = await seedWorker(cleanup, w.loc);
    const kept = await seedWorker(cleanup, w.loc);
    const v1 = await seedRosterPlan(cleanup, w.loc, {
      status: "published",
      weekStart: THIS_WEEK,
      version: 1,
    });
    const v2 = await seedRosterPlan(cleanup, w.loc, {
      status: "published",
      weekStart: THIS_WEEK,
      version: 2,
    });
    const rostered = (planId: string, workerId: string) =>
      seedAssignment(cleanup, {
        planId,
        loc: w.loc,
        workerId,
        workAreaId: w.area.id,
        shiftId: w.shift.id,
        date: "2026-01-06",
      });
    // Version 1 rostered `stale` on Tuesday with nothing recorded; the
    // republished version 2 dropped them and kept `kept`, who was recorded.
    await rostered(v1.id, stale.id);
    await rostered(v2.id, kept.id);
    await seedAttendance(cleanup, {
      loc: w.loc,
      workerId: kept.id,
      workAreaId: w.area.id,
      shiftId: w.shift.id,
      recordedBy: w.admin.id,
      date: "2026-01-06",
    });

    const [row] = await loadActions(asActor(w.admin), NOW);

    expect(row.attendance?.incomplete).toEqual({ count: 0, oldest: null });
  });

  test("a past day rostered only by the latest plan version and unrecorded is in the backlog", async () => {
    const w = await world();
    const early = await seedWorker(cleanup, w.loc);
    const added = await seedWorker(cleanup, w.loc);
    const v1 = await seedRosterPlan(cleanup, w.loc, {
      status: "published",
      weekStart: THIS_WEEK,
      version: 1,
    });
    const v2 = await seedRosterPlan(cleanup, w.loc, {
      status: "published",
      weekStart: THIS_WEEK,
      version: 2,
    });
    const rostered = (planId: string, workerId: string, date: string) =>
      seedAssignment(cleanup, {
        planId,
        loc: w.loc,
        workerId,
        workAreaId: w.area.id,
        shiftId: w.shift.id,
        date,
      });
    // Monday: only version 1 rosters `early` (unrecorded), so it does not
    // count. Tuesday: only version 2 rosters `added` (unrecorded), so it does.
    await rostered(v1.id, early.id, "2026-01-05");
    await rostered(v2.id, added.id, "2026-01-06");

    const [row] = await loadActions(asActor(w.admin), NOW);

    expect(row.attendance?.incomplete).toEqual({
      count: 1,
      oldest: "2026-01-06",
    });
  });

  test("an admin's weekly draft, ready-to-generate week and open requests", async () => {
    const w = await world();
    await seedRosterPlan(cleanup, w.loc, {
      status: "draft",
      weekStart: NEXT_WEEK,
    });
    await seedMpRequest(cleanup, w.loc, {
      createdBy: w.admin.id,
      status: "approved",
      weekStart: THIS_WEEK,
    });
    await seedMpRequest(cleanup, w.loc, {
      createdBy: w.admin.id,
      status: "open",
      weekStart: NEXT_WEEK,
      createdAt: daysBefore(9),
    });
    await seedMpRequest(cleanup, w.loc, {
      createdBy: w.admin.id,
      status: "open",
      type: "daily",
      requestDate: "2026-01-08",
      createdAt: daysBefore(3),
    });

    const [row] = await loadActions(asActor(w.admin), NOW);

    expect(row.weeklyDrafts).toEqual([NEXT_WEEK]);
    expect(row.readyToGenerate).toEqual([THIS_WEEK]);
    expect(row.openRequests).toEqual({ daily: 1, oldestAgeDays: 3 });
  });

  test("an ho gets every location of the site with attendance null and nothing ready to generate", async () => {
    const w = await world();
    const second = await seedLocation(cleanup, w.s.id);
    await seedMpRequest(cleanup, second, {
      createdBy: w.ho.id,
      status: "approved",
      weekStart: THIS_WEEK,
    });
    await seedRosterPlan(cleanup, w.loc, {
      status: "draft",
      weekStart: THIS_WEEK,
    });

    const result = await loadActions(asActor(w.ho), NOW);

    expect(result.map((row) => row.locationId).sort()).toEqual(
      [w.loc.id, second.id].sort(),
    );
    expect(result.every((row) => row.attendance === null)).toBe(true);
    expect(result.every((row) => row.readyToGenerate.length === 0)).toBe(true);
    expect(
      result.find((row) => row.locationId === w.loc.id)?.weeklyDrafts,
    ).toEqual([THIS_WEEK]);
  });

  test("another site's requests and drafts never count", async () => {
    const mine = await world();
    const theirs = await world();
    await seedMpRequest(cleanup, theirs.loc, {
      createdBy: theirs.admin.id,
      status: "open",
    });
    await seedRosterPlan(cleanup, theirs.loc, {
      status: "draft",
      weekStart: THIS_WEEK,
    });

    const forHo = await loadActions(asActor(mine.ho), NOW);
    const forAdmin = await loadActions(asActor(mine.admin), NOW);

    for (const rows of [forHo, forAdmin]) {
      expect(rows.map((row) => row.locationId)).toEqual([mine.loc.id]);
      expect(rows[0].openRequests).toEqual({
        daily: 0,
        oldestAgeDays: null,
      });
      expect(rows[0].weeklyDrafts).toEqual([]);
    }
  });

  test("an unbound actor gets nothing", async () => {
    const unboundHo: Actor = { role: "ho", siteId: null, siteLocationId: null };
    const unboundAdmin: Actor = {
      role: "admin",
      siteId: null,
      siteLocationId: null,
    };

    expect(await loadActions(unboundHo, NOW)).toEqual([]);
    expect(await loadActions(unboundAdmin, NOW)).toEqual([]);
  });

  test("each location in a list gets its own today and week", async () => {
    const w = await world();
    const wit = await seedLocation(cleanup, w.s.id, {
      timezone: "Asia/Jayapura",
    });
    // 16:30 UTC on Sunday the 11th: still Sunday 23:30 in Jakarta, already
    // Monday the 12th at 01:30 in Jayapura, so a draft of the week of the 12th
    // is "this week" for Jayapura and "next week" for Jakarta; both list it.
    // A draft of the week of the 19th is next week only for Jayapura.
    const late = new Date("2026-01-11T16:30:00Z");
    await seedRosterPlan(cleanup, w.loc, {
      status: "draft",
      weekStart: "2026-01-19",
    });
    await seedRosterPlan(cleanup, wit, {
      status: "draft",
      weekStart: "2026-01-19",
    });

    const result = await loadActions(asActor(w.ho), late);
    const jakarta = result.find((row) => row.locationId === w.loc.id);
    const jayapura = result.find((row) => row.locationId === wit.id);

    expect(jakarta?.today).toBe("2026-01-11");
    expect(jayapura?.today).toBe("2026-01-12");
    expect(jakarta?.weeklyDrafts).toEqual([]);
    expect(jayapura?.weeklyDrafts).toEqual(["2026-01-19"]);
  });
});
