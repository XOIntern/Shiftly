import { describe, expect, test } from "bun:test";

import { dayFromNumber, dayNumber, mondayOf, monthKey } from "./dates";

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
