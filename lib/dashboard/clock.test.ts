import { describe, expect, test } from "bun:test";

import { clockFor } from "./clock";

// 16:30 UTC is 23:30 in Jakarta (UTC+7) but already 01:30 the next day in
// Jayapura (UTC+9).
const now = new Date("2026-01-07T16:30:00Z");

describe("clockFor", () => {
  test("today is decided in the location's own zone", () => {
    expect(clockFor("Asia/Jakarta", now).today).toBe("2026-01-07");
    expect(clockFor("Asia/Jayapura", now).today).toBe("2026-01-08");
  });

  test("week is the Monday of today and nextWeek the Monday after", () => {
    const clock = clockFor("Asia/Jakarta", now);
    expect(clock.week).toBe("2026-01-05");
    expect(clock.nextWeek).toBe("2026-01-12");
  });

  test("on a Sunday the week is the preceding Monday", () => {
    const sunday = new Date("2026-01-11T05:00:00Z");
    const clock = clockFor("Asia/Jakarta", sunday);
    expect(clock.today).toBe("2026-01-11");
    expect(clock.week).toBe("2026-01-05");
    expect(clock.nextWeek).toBe("2026-01-12");
  });

  test("the zone can move the week across a Monday boundary", () => {
    // Sunday 16:30 UTC: still Sunday in Jakarta, already Monday in Jayapura.
    const edge = new Date("2026-01-11T16:30:00Z");
    expect(clockFor("Asia/Jakarta", edge).week).toBe("2026-01-05");
    expect(clockFor("Asia/Jayapura", edge).week).toBe("2026-01-12");
  });

  test("pastDays is the 7 dates before today, oldest first", () => {
    expect(clockFor("Asia/Jakarta", now).pastDays).toEqual([
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
    ]);
  });
});
