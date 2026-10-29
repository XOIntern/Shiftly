import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { db } from "@/lib/db";
import type { MpRequestRow } from "@/types/mp-request";

import {
  requestMutability,
  rosterLockedWeeks,
  weekKey,
} from "./mp-request-lock";
import { installCleanup } from "./test-cleanup";
import { seedLocation, seedRosterPlan, seedSite } from "./test-fixtures";

const cleanup = installCleanup();

const WEEK = "2026-10-12";
const OTHER_WEEK = "2026-10-19";

type Status = MpRequestRow["status"];

function weekly(siteLocationId: string, status: Status, weekStart = WEEK) {
  return { type: "weekly" as const, status, siteLocationId, weekStart };
}

function daily(siteLocationId: string, status: Status) {
  return { type: "daily" as const, status, siteLocationId, weekStart: null };
}

describe("weekKey", () => {
  test("joins location and week", () => {
    expect(weekKey("loc", WEEK)).toBe("loc|2026-10-12");
  });
});

describe("requestMutability", () => {
  test("a daily request is mutable only while open", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    expect(await requestMutability(db, daily(loc.id, "open"))).toBe("mutable");
    for (const status of [
      "approved",
      "fulfilled",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(await requestMutability(db, daily(loc.id, status))).toBe("closed");
    }
  });

  test("an approved weekly with no plan is mutable", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    expect(await requestMutability(db, weekly(loc.id, "approved"))).toBe(
      "mutable",
    );
  });

  test("an approved weekly with a draft weekly plan is rostered", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, loc, { weekStart: WEEK, status: "draft" });
    expect(await requestMutability(db, weekly(loc.id, "approved"))).toBe(
      "rostered",
    );
  });

  test("an approved weekly with a published weekly plan is rostered", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, loc, {
      weekStart: WEEK,
      status: "published",
    });
    expect(await requestMutability(db, weekly(loc.id, "approved"))).toBe(
      "rostered",
    );
  });

  test("a weekly that is not approved is closed, plan or not", async () => {
    const s = await seedSite(cleanup);
    const bare = await seedLocation(cleanup, s.id);
    const planned = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, planned, { weekStart: WEEK });
    for (const status of [
      "open",
      "fulfilled",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(await requestMutability(db, weekly(bare.id, status))).toBe(
        "closed",
      );
      expect(await requestMutability(db, weekly(planned.id, status))).toBe(
        "closed",
      );
    }
  });

  test("a plan for another week does not lock the request", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, loc, { weekStart: OTHER_WEEK });
    expect(await requestMutability(db, weekly(loc.id, "approved"))).toBe(
      "mutable",
    );
  });

  test("a plan for another location does not lock the request", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    const other = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, other, { weekStart: WEEK });
    expect(await requestMutability(db, weekly(loc.id, "approved"))).toBe(
      "mutable",
    );
  });

  test("a daily plan inside the week does not lock the weekly request", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, loc, { requestDate: "2026-10-14" });
    expect(await requestMutability(db, weekly(loc.id, "approved"))).toBe(
      "mutable",
    );
  });

  test("a weekly plan does not lock an open daily request", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, loc, { weekStart: WEEK });
    expect(await requestMutability(db, daily(loc.id, "open"))).toBe("mutable");
  });
});

describe("rosterLockedWeeks", () => {
  test("returns only the asked-for pairs that have a weekly plan", async () => {
    const s = await seedSite(cleanup);
    const a = await seedLocation(cleanup, s.id);
    const b = await seedLocation(cleanup, s.id);
    await seedRosterPlan(cleanup, a, { weekStart: WEEK, status: "draft" });
    await seedRosterPlan(cleanup, b, {
      weekStart: OTHER_WEEK,
      status: "published",
    });

    const locked = await rosterLockedWeeks([
      { siteLocationId: a.id, weekStart: WEEK },
      { siteLocationId: a.id, weekStart: OTHER_WEEK },
      { siteLocationId: b.id, weekStart: WEEK },
    ]);

    expect([...locked]).toEqual([weekKey(a.id, WEEK)]);
  });

  test("an empty pair list returns an empty set", async () => {
    expect((await rosterLockedWeeks([])).size).toBe(0);
  });
});
