import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { installCleanup } from "../test-cleanup";
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
import { loadAttendanceToday } from "./attendance-today";

const cleanup = installCleanup();

// 2026-01-07 23:30 in Jakarta, already 2026-01-08 01:30 in Jayapura.
const NOW = new Date("2026-01-07T16:30:00Z");
const WEEK = "2026-01-05";

async function location(
  siteId: string,
  timezone?: "Asia/Jakarta" | "Asia/Jayapura",
) {
  const loc = await seedLocation(cleanup, siteId, { timezone });
  const area = await seedWorkArea(cleanup, loc);
  const shift = await seedShift(cleanup, loc);
  const plan = await seedRosterPlan(cleanup, loc, {
    status: "published",
    weekStart: WEEK,
  });
  return { loc, area, shift, plan };
}

type Place = Awaited<ReturnType<typeof location>>;

async function rosterWorker(place: Place, date: string) {
  const worker = await seedWorker(cleanup, place.loc);
  await seedAssignment(cleanup, {
    planId: place.plan.id,
    loc: place.loc,
    workerId: worker.id,
    workAreaId: place.area.id,
    shiftId: place.shift.id,
    date,
  });
  return worker;
}

describe("loadAttendanceToday", () => {
  test("an admin gets one entry that counts the day's records, roster and unscheduled work", async () => {
    const s = await seedSite(cleanup);
    const place = await location(s.id, "Asia/Jakarta");
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: s.id,
      siteLocationId: place.loc.id,
    });
    const present = await rosterWorker(place, "2026-01-07");
    const onLeave = await rosterWorker(place, "2026-01-07");
    await rosterWorker(place, "2026-01-07");
    const extra = await seedWorker(cleanup, place.loc);
    const record = (
      workerId: string,
      status: "present" | "leave",
      withoutRoster = false,
    ) =>
      seedAttendance(cleanup, {
        loc: place.loc,
        workerId,
        workAreaId: place.area.id,
        shiftId: place.shift.id,
        recordedBy: admin.id,
        date: "2026-01-07",
        status,
        withoutRoster,
      });
    await record(present.id, "present");
    await record(onLeave.id, "leave");
    await record(extra.id, "present", true);

    const result = await loadAttendanceToday(
      { role: "admin", siteId: s.id, siteLocationId: place.loc.id },
      NOW,
    );

    expect(result).toEqual([
      {
        locationId: place.loc.id,
        locationName: place.loc.name,
        today: "2026-01-07",
        summary: {
          scheduled: 3,
          presentScheduled: 1,
          present: 2,
          leave: 1,
          sick: 0,
          absent: 0,
          unrecorded: 1,
          unscheduled: 1,
        },
      },
    ]);
  });

  test("each location counts only the rows of its own today", async () => {
    const s = await seedSite(cleanup);
    const jakarta = await location(s.id, "Asia/Jakarta");
    const jayapura = await location(s.id, "Asia/Jayapura");

    // Jakarta is on the 7th: one rostered worker there, two on the 8th.
    await rosterWorker(jakarta, "2026-01-07");
    await rosterWorker(jakarta, "2026-01-08");
    await rosterWorker(jakarta, "2026-01-08");
    // Jayapura is on the 8th: one rostered worker there, two on the 7th.
    await rosterWorker(jayapura, "2026-01-08");
    await rosterWorker(jayapura, "2026-01-07");
    await rosterWorker(jayapura, "2026-01-07");

    const result = await loadAttendanceToday(
      { role: "ho", siteId: s.id, siteLocationId: null },
      NOW,
    );
    const byId = new Map(result.map((row) => [row.locationId, row]));

    expect(result).toHaveLength(2);
    expect(byId.get(jakarta.loc.id)?.today).toBe("2026-01-07");
    expect(byId.get(jakarta.loc.id)?.summary.unrecorded).toBe(1);
    expect(byId.get(jayapura.loc.id)?.today).toBe("2026-01-08");
    expect(byId.get(jayapura.loc.id)?.summary.unrecorded).toBe(1);
  });

  test("an unbound actor gets nothing", async () => {
    const s = await seedSite(cleanup);
    await location(s.id);

    expect(
      await loadAttendanceToday(
        { role: "admin", siteId: s.id, siteLocationId: null },
        NOW,
      ),
    ).toEqual([]);
    expect(
      await loadAttendanceToday(
        { role: "ho", siteId: null, siteLocationId: null },
        NOW,
      ),
    ).toEqual([]);
  });
});
