import "dotenv/config";
import { describe, expect, test } from "bun:test";

import type { RequirementLine } from "../engine/generate";
import { installCleanup } from "../test-cleanup";
import {
  seedAssignment,
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
} from "../test-fixtures";
import { deriveCoverage, loadRosterCoverage } from "./roster-coverage";

const cleanup = installCleanup();

const MONDAY = "2026-01-05";
const WEDNESDAY = "2026-01-07";

const line = (overrides: Partial<RequirementLine> = {}): RequirementLine => ({
  workAreaId: "area",
  shiftDefId: "shift",
  positionId: "position",
  date: MONDAY,
  headcount: 1,
  ...overrides,
});

const fill = (workerId: string, date = MONDAY) => ({
  workerId,
  date,
  shiftDefId: "shift",
  workAreaId: "area",
});

const empty = {
  weeklyLines: [],
  dailyLines: [],
  weeklyAssignments: [],
  dailyAssignments: [],
  fulfilledDailyLines: [],
};

describe("deriveCoverage", () => {
  test("weekly demand 3 with 2 assigned leaves a deficit of 1", () => {
    expect(
      deriveCoverage({
        ...empty,
        weeklyLines: [line({ headcount: 3 })],
        weeklyAssignments: [fill("w1"), fill("w2")],
      }),
    ).toEqual({ required: 3, filled: 2, deficit: 1 });
  });

  test("no lines gives zeros", () => {
    expect(deriveCoverage(empty)).toEqual({ required: 0, filled: 0, deficit: 0 });
  });

  test("over-assignment never makes the deficit negative", () => {
    expect(
      deriveCoverage({
        ...empty,
        weeklyLines: [line({ headcount: 1 })],
        weeklyAssignments: [fill("w1"), fill("w2"), fill("w3")],
      }),
    ).toEqual({ required: 1, filled: 1, deficit: 0 });
  });

  test("a daily fill discounted by a fulfilled daily line does not count toward an open daily request", () => {
    expect(
      deriveCoverage({
        ...empty,
        dailyLines: [line({ date: WEDNESDAY, headcount: 1 })],
        dailyAssignments: [fill("w1", WEDNESDAY)],
        fulfilledDailyLines: [
          { workAreaId: "area", shiftDefId: "shift", date: WEDNESDAY, headcount: 1 },
        ],
      }),
    ).toEqual({ required: 1, filled: 0, deficit: 1 });
  });

  test("weekly and daily demand add up", () => {
    expect(
      deriveCoverage({
        ...empty,
        weeklyLines: [line({ headcount: 2 })],
        dailyLines: [line({ date: WEDNESDAY, headcount: 2 })],
        weeklyAssignments: [fill("w1")],
        dailyAssignments: [fill("w2", WEDNESDAY), fill("w3", WEDNESDAY)],
      }),
    ).toEqual({ required: 4, filled: 3, deficit: 1 });
  });
});

// Wednesday 2026-01-07 12:00 in Jakarta: the week of 2026-01-05.
const NOW = new Date("2026-01-07T05:00:00Z");

async function place(
  siteId: string,
  timezone?: "Asia/Jakarta" | "Asia/Jayapura",
) {
  const loc = await seedLocation(cleanup, siteId, { timezone });
  const pos = await seedPosition(cleanup, siteId);
  const area = await seedWorkArea(cleanup, loc, { positionIds: [pos.id] });
  const shift = await seedShift(cleanup, loc);
  const creator = await seedUser(cleanup, {
    role: "admin",
    siteId,
    siteLocationId: loc.id,
  });
  return { loc, area, shift, pos, creator };
}

type Place = Awaited<ReturnType<typeof place>>;

async function request(
  p: Place,
  opts: {
    status: "open" | "approved" | "fulfilled";
    type?: "weekly" | "daily";
    lines?: { date?: string; headcount?: number }[];
  },
) {
  const req = await seedMpRequest(cleanup, p.loc, {
    createdBy: p.creator.id,
    status: opts.status,
    type: opts.type,
    weekStart: MONDAY,
    requestDate: opts.type === "daily" ? opts.lines?.[0]?.date : undefined,
  });
  for (const l of opts.lines ?? []) {
    await seedRequestLine(cleanup, {
      requestId: req.id,
      loc: p.loc,
      workAreaId: p.area.id,
      shiftId: p.shift.id,
      positionId: p.pos.id,
      ...l,
    });
  }
  return req;
}

async function plan(
  p: Place,
  opts: { status?: "draft" | "published"; version?: number; requestDate?: string },
  fills: number,
  date = MONDAY,
) {
  const rp = await seedRosterPlan(cleanup, p.loc, {
    ...opts,
    weekStart: opts.requestDate ? undefined : MONDAY,
  });
  for (let i = 0; i < fills; i++) {
    const w = await seedWorker(cleanup, p.loc);
    await seedAssignment(cleanup, {
      planId: rp.id,
      loc: p.loc,
      workerId: w.id,
      workAreaId: p.area.id,
      shiftId: p.shift.id,
      date,
    });
  }
  return rp;
}

const adminOf = (p: Place) => ({
  role: "admin" as const,
  siteId: p.loc.siteId,
  siteLocationId: p.loc.id,
});

describe("loadRosterCoverage", () => {
  test("filled counts only the latest published weekly plan", async () => {
    const s = await seedSite(cleanup);
    const p = await place(s.id);
    await request(p, { status: "approved", lines: [{ headcount: 3 }] });
    await plan(p, { status: "published", version: 1 }, 3);
    await plan(p, { status: "published", version: 2 }, 1);
    await plan(p, { status: "draft", version: 3 }, 2);

    const [coverage] = await loadRosterCoverage(adminOf(p), NOW);
    expect(coverage).toMatchObject({
      locationId: p.loc.id,
      locationName: p.loc.name,
      week: MONDAY,
      required: 3,
      filled: 1,
      deficit: 2,
    });
  });

  test("a draft plan alone fills nothing", async () => {
    const s = await seedSite(cleanup);
    const p = await place(s.id);
    await request(p, { status: "approved", lines: [{ headcount: 2 }] });
    await plan(p, { status: "draft", version: 1 }, 2);

    const [coverage] = await loadRosterCoverage(adminOf(p), NOW);
    expect(coverage).toMatchObject({ required: 2, filled: 0, deficit: 2 });
  });

  test("an approved request with no plan reports filled 0; one with no lines reports zeros", async () => {
    const s = await seedSite(cleanup);
    const withLines = await place(s.id);
    await request(withLines, { status: "approved", lines: [{ headcount: 2 }] });
    const noLines = await place(s.id);
    await request(noLines, { status: "approved" });

    expect(await loadRosterCoverage(adminOf(withLines), NOW)).toMatchObject([
      { required: 2, filled: 0, deficit: 2 },
    ]);
    expect(await loadRosterCoverage(adminOf(noLines), NOW)).toMatchObject([
      { required: 0, filled: 0, deficit: 0 },
    ]);
  });

  test("demand is approved or fulfilled weekly plus open daily; fulfilled daily fills are discounted", async () => {
    const s = await seedSite(cleanup);
    const p = await place(s.id);
    await request(p, { status: "fulfilled", lines: [{ headcount: 1 }] });
    await request(p, { status: "open", lines: [{ headcount: 5 }] });
    await request(p, {
      status: "open",
      type: "daily",
      lines: [{ date: WEDNESDAY, headcount: 2 }],
    });
    await request(p, {
      status: "fulfilled",
      type: "daily",
      lines: [{ date: WEDNESDAY, headcount: 1 }],
    });
    await plan(p, { status: "published", version: 1 }, 1);
    // Two daily fills on the slot: one belongs to the fulfilled request.
    await plan(p, { requestDate: WEDNESDAY }, 2, WEDNESDAY);

    const [coverage] = await loadRosterCoverage(adminOf(p), NOW);
    expect(coverage).toMatchObject({ required: 3, filled: 2, deficit: 1 });
  });

  test("ho sees every location of the site, each at its own week, and none of another site's", async () => {
    const s = await seedSite(cleanup);
    const other = await seedSite(cleanup);
    const jakarta = await place(s.id, "Asia/Jakarta");
    const jayapura = await place(s.id, "Asia/Jayapura");
    await place(other.id);

    // Sunday 23:30 in Jakarta, already Monday 01:30 in Jayapura.
    const sundayNight = new Date("2026-01-11T16:30:00Z");
    const result = await loadRosterCoverage(
      { role: "ho", siteId: s.id, siteLocationId: null },
      sundayNight,
    );
    const ids = [jakarta.loc.id, jayapura.loc.id];
    expect(result.map((r) => r.locationId).sort()).toEqual(ids.sort());
    const weekOf = (id: string) => result.find((r) => r.locationId === id)?.week;
    expect(weekOf(jakarta.loc.id)).toBe("2026-01-05");
    expect(weekOf(jayapura.loc.id)).toBe("2026-01-12");
    expect(result.every((r) => r.siteName.length > 0)).toBe(true);
  });

  test("an unbound actor gets nothing", async () => {
    expect(
      await loadRosterCoverage(
        { role: "ho", siteId: null, siteLocationId: null },
        NOW,
      ),
    ).toEqual([]);
    expect(
      await loadRosterCoverage(
        { role: "admin", siteId: null, siteLocationId: null },
        NOW,
      ),
    ).toEqual([]);
  });
});
