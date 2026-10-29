import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { worker } from "@/drizzle/schema";
import { db } from "@/lib/db";

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
import { deriveRosterStatus, loadLocationOverview } from "./location-overview";

const cleanup = installCleanup();

// 2026-01-07 23:30 in Jakarta, already 2026-01-08 01:30 in Jayapura; both
// are in the week of Monday 2026-01-05.
const NOW = new Date("2026-01-07T16:30:00Z");
const WEEK = "2026-01-05";

describe("deriveRosterStatus", () => {
  test("no plans is none", () => {
    expect(deriveRosterStatus([])).toBe("none");
  });

  test("a draft only is draft", () => {
    expect(deriveRosterStatus([{ status: "draft" }])).toBe("draft");
  });

  test("any published plan wins over a draft", () => {
    expect(
      deriveRosterStatus([{ status: "draft" }, { status: "published" }]),
    ).toBe("published");
  });
});

async function place(
  siteId: string,
  timezone?: "Asia/Jakarta" | "Asia/Jayapura",
) {
  const loc = await seedLocation(cleanup, siteId, { timezone });
  const area = await seedWorkArea(cleanup, loc);
  const shift = await seedShift(cleanup, loc);
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId,
    siteLocationId: loc.id,
  });
  return { loc, area, shift, admin };
}

type Place = Awaited<ReturnType<typeof place>>;

describe("loadLocationOverview", () => {
  test("activeWorkers excludes soft-deleted and inactive workers of the location", async () => {
    const s = await seedSite(cleanup);
    const p = await place(s.id);
    await seedWorker(cleanup, p.loc);
    await seedWorker(cleanup, p.loc);
    await seedWorker(cleanup, p.loc, { deleted: true });
    const inactive = await seedWorker(cleanup, p.loc);
    await db
      .update(worker)
      .set({ isActive: false })
      .where(eq(worker.id, inactive.id));
    // Another location's worker must not count.
    const other = await place(s.id);
    await seedWorker(cleanup, other.loc);

    const rows = await loadLocationOverview(
      { role: "admin", siteId: s.id, siteLocationId: p.loc.id },
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].activeWorkers).toBe(2);
  });

  test("present and scheduled count the location's own today", async () => {
    const s = await seedSite(cleanup);
    const jakarta = await place(s.id, "Asia/Jakarta");
    const jayapura = await place(s.id, "Asia/Jayapura");

    const plans = new Map<string, { id: string }>();
    async function rostered(p: Place, date: string, present: boolean) {
      // One published plan per location: only the latest version is read.
      if (!plans.has(p.loc.id)) {
        plans.set(
          p.loc.id,
          await seedRosterPlan(cleanup, p.loc, {
            status: "published",
            weekStart: WEEK,
          }),
        );
      }
      const plan = plans.get(p.loc.id)!;
      const w = await seedWorker(cleanup, p.loc);
      await seedAssignment(cleanup, {
        planId: plan.id,
        loc: p.loc,
        workerId: w.id,
        workAreaId: p.area.id,
        shiftId: p.shift.id,
        date,
      });
      if (present) {
        await seedAttendance(cleanup, {
          loc: p.loc,
          workerId: w.id,
          workAreaId: p.area.id,
          shiftId: p.shift.id,
          recordedBy: p.admin.id,
          date,
        });
      }
    }

    // Jakarta's today is the 7th: two scheduled, one present; one more on the 8th.
    await rostered(jakarta, "2026-01-07", true);
    await rostered(jakarta, "2026-01-07", false);
    await rostered(jakarta, "2026-01-08", true);
    // Jayapura's today is the 8th: one scheduled and present; two on the 7th.
    await rostered(jayapura, "2026-01-08", true);
    await rostered(jayapura, "2026-01-07", true);
    await rostered(jayapura, "2026-01-07", false);

    const rows = await loadLocationOverview(
      { role: "ho", siteId: s.id, siteLocationId: null },
      NOW,
    );
    const byId = new Map(rows.map((row) => [row.locationId, row]));

    expect(byId.get(jakarta.loc.id)).toMatchObject({
      presentToday: 1,
      scheduledToday: 2,
    });
    expect(byId.get(jayapura.loc.id)).toMatchObject({
      presentToday: 1,
      scheduledToday: 1,
    });
  });

  test("rosterStatus follows the weekly plans of the current week only", async () => {
    const s = await seedSite(cleanup);
    const published = await place(s.id);
    const draft = await place(s.id);
    const noneThisWeek = await place(s.id);
    await seedRosterPlan(cleanup, published.loc, {
      status: "draft",
      weekStart: WEEK,
    });
    await seedRosterPlan(cleanup, published.loc, {
      status: "published",
      weekStart: WEEK,
      version: 2,
    });
    await seedRosterPlan(cleanup, draft.loc, {
      status: "draft",
      weekStart: WEEK,
    });
    // A published daily plan and a published plan of another week must not
    // influence the status.
    await seedRosterPlan(cleanup, draft.loc, {
      status: "published",
      requestDate: "2026-01-07",
    });
    await seedRosterPlan(cleanup, noneThisWeek.loc, {
      status: "published",
      weekStart: "2026-01-12",
    });

    const rows = await loadLocationOverview(
      { role: "ho", siteId: s.id, siteLocationId: null },
      NOW,
    );
    const status = (p: Place) =>
      rows.find((row) => row.locationId === p.loc.id)?.rosterStatus;

    expect(status(published)).toBe("published");
    expect(status(draft)).toBe("draft");
    expect(status(noneThisWeek)).toBe("none");
  });

  test("openRequests counts only open requests of that location, both types", async () => {
    const s = await seedSite(cleanup);
    const p = await place(s.id);
    const other = await place(s.id);
    const createdBy = p.admin.id;
    await seedMpRequest(cleanup, p.loc, { createdBy, status: "open" });
    await seedMpRequest(cleanup, p.loc, {
      createdBy,
      status: "open",
      type: "daily",
      requestDate: "2026-01-08",
    });
    await seedMpRequest(cleanup, p.loc, {
      createdBy,
      status: "approved",
      weekStart: "2026-01-12",
    });
    await seedMpRequest(cleanup, p.loc, {
      createdBy,
      status: "rejected",
      weekStart: "2026-01-19",
    });
    await seedMpRequest(cleanup, other.loc, {
      createdBy: other.admin.id,
      status: "open",
    });

    const rows = await loadLocationOverview(
      { role: "admin", siteId: s.id, siteLocationId: p.loc.id },
      NOW,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].openRequests).toBe(2);
  });

  test("a location with nothing still appears with zeros and none", async () => {
    const s = await seedSite(cleanup);
    const p = await place(s.id);

    const rows = await loadLocationOverview(
      { role: "ho", siteId: s.id, siteLocationId: null },
      NOW,
    );

    expect(rows).toEqual([
      {
        locationId: p.loc.id,
        locationName: p.loc.name,
        siteId: s.id,
        siteName: s.name,
        activeWorkers: 0,
        presentToday: 0,
        scheduledToday: 0,
        rosterStatus: "none",
        openRequests: 0,
      },
    ]);
  });

  test("superadmin gets rows from both sites, ho only its own", async () => {
    const a = await seedSite(cleanup);
    const b = await seedSite(cleanup);
    const pa = await place(a.id);
    const pb = await place(b.id);

    const all = await loadLocationOverview(
      { role: "superadmin", siteId: null, siteLocationId: null },
      NOW,
    );
    const ids = all.map((row) => row.locationId);
    expect(ids).toContain(pa.loc.id);
    expect(ids).toContain(pb.loc.id);

    const ho = await loadLocationOverview(
      { role: "ho", siteId: a.id, siteLocationId: null },
      NOW,
    );
    expect(ho.map((row) => row.locationId)).toEqual([pa.loc.id]);
  });

  test("an unbound actor gets nothing", async () => {
    const s = await seedSite(cleanup);
    await place(s.id);

    expect(
      await loadLocationOverview(
        { role: "admin", siteId: s.id, siteLocationId: null },
        NOW,
      ),
    ).toEqual([]);
    expect(
      await loadLocationOverview(
        { role: "ho", siteId: null, siteLocationId: null },
        NOW,
      ),
    ).toEqual([]);
  });
});
