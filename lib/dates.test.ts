import { describe, expect, test } from "bun:test";

import {
  dayFromNumber,
  dayNumber,
  isFutureDate,
  mondayOf,
  monthKey,
  todayIn,
} from "./dates";

// Task 1 of the roster-engine plan: the date helpers promoted verbatim out
// of validate.ts. Everything in the engine imports dates from here.

describe("dates", () => {
  test("dayNumber maps YYYY-MM-DD onto days since 1970-01-01", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("2026-01-05")).toBe(20458);
    expect(dayNumber("2026-03-01")).toBe(20513);
  });

  test("dayFromNumber inverts dayNumber", () => {
    expect(dayFromNumber(0)).toBe("1970-01-01");
    expect(dayFromNumber(dayNumber("2026-01-05"))).toBe("2026-01-05");
    expect(dayFromNumber(dayNumber("2026-12-31"))).toBe("2026-12-31");
  });

  test("mondayOf snaps backward to the Monday-start week", () => {
    expect(mondayOf("2026-01-05")).toBe("2026-01-05"); // Monday
    expect(mondayOf("2026-01-04")).toBe("2025-12-29"); // Sunday → prior Monday
    expect(mondayOf("2026-01-10")).toBe("2026-01-05"); // Saturday
  });

  test("monthKey keeps the YYYY-MM prefix", () => {
    expect(monthKey("2026-01-05")).toBe("2026-01");
    expect(monthKey("2026-03-31")).toBe("2026-03");
  });
});

// 16:30 UTC is already the next day in WITA (UTC+8) and WIT (UTC+9) but not
// in WIB (UTC+7): the three zones disagree on "today" at this instant.
describe("todayIn / isFutureDate", () => {
  const NOW = new Date("2026-10-29T16:30:00Z");

  test("todayIn is still the 29th in WIB (23:30)", () => {
    expect(todayIn("Asia/Jakarta", NOW)).toBe("2026-10-29");
  });

  test("todayIn is already the 30th in WITA and WIT", () => {
    expect(todayIn("Asia/Makassar", NOW)).toBe("2026-10-30");
    expect(todayIn("Asia/Jayapura", NOW)).toBe("2026-10-30");
  });

  test("isFutureDate follows the zone of the location", () => {
    expect(isFutureDate("2026-10-30", "Asia/Jakarta", NOW)).toBe(true);
    expect(isFutureDate("2026-10-30", "Asia/Makassar", NOW)).toBe(false);
    expect(isFutureDate("2026-10-29", "Asia/Jakarta", NOW)).toBe(false);
  });
});
