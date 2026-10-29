import { describe, expect, test } from "bun:test";

import { dayNumber } from "@/lib/dates";
import { weekDates } from "@/lib/week";
import type { RequestedWeek } from "@/types/mp-request";

import {
  dayAriaLabel,
  daysOfWeeks,
  markedWeeks,
  toIso,
  toLocalDate,
  weekDayRange,
} from "./week-calendar";

describe("markedWeeks", () => {
  test("maps open and approved weeks to taken and fulfilled-only weeks to fulfilled", () => {
    const marks = markedWeeks([
      { weekStart: "2026-02-02", status: "open" },
      { weekStart: "2026-02-09", status: "approved" },
      { weekStart: "2026-02-16", status: "fulfilled" },
    ]);

    expect([...marks]).toEqual([
      ["2026-02-02", "taken"],
      ["2026-02-09", "taken"],
      ["2026-02-16", "fulfilled"],
    ]);
  });

  test("a week holding both a fulfilled and an open request is taken whichever comes first", () => {
    const fulfilled: RequestedWeek = { weekStart: "2026-03-02", status: "fulfilled" };
    const open: RequestedWeek = { weekStart: "2026-03-02", status: "open" };

    expect(markedWeeks([fulfilled, open]).get("2026-03-02")).toBe("taken");
    expect(markedWeeks([open, fulfilled]).get("2026-03-02")).toBe("taken");
  });

  test("no weeks, no marks", () => {
    expect(markedWeeks([]).size).toBe(0);
  });
});

describe("weekDayRange", () => {
  test("February 2026 starts on a Sunday, so its grid begins the Monday before", () => {
    expect(weekDayRange(toLocalDate("2026-02-01"))).toEqual({
      from: "2026-01-26",
      to: "2026-03-01",
    });
  });

  test("December 2026 reaches into the next year on its last row", () => {
    expect(weekDayRange(toLocalDate("2026-12-01"))).toEqual({
      from: "2026-11-30",
      to: "2027-01-03",
    });
  });

  test("a month that fills whole Monday-to-Sunday weeks is not padded", () => {
    expect(weekDayRange(toLocalDate("2027-02-01"))).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
  });

  test("any day of the month gives the same range as its first", () => {
    expect(weekDayRange(toLocalDate("2026-12-17"))).toEqual(
      weekDayRange(toLocalDate("2026-12-01")),
    );
  });

  test("every visible cell of every month in 2026 and 2027 falls inside the range, within the 62-day cap", () => {
    for (let month = 0; month < 24; month++) {
      const first = new Date(2026, month, 1);
      const { from, to } = weekDayRange(first);
      const lastOfMonth = toIso(new Date(2026, month + 1, 0));

      expect(dayNumber(to) - dayNumber(from)).toBeLessThanOrEqual(62);
      expect(from <= toIso(first)).toBe(true);
      expect(to >= lastOfMonth).toBe(true);
      // Monday through Sunday, so no visible row is cut short.
      expect(toLocalDate(from).getDay()).toBe(1);
      expect(toLocalDate(to).getDay()).toBe(0);
    }
  });
});

describe("toLocalDate / toIso", () => {
  test("round-trip across a year end, a leap day and a spring DST change", () => {
    for (const iso of ["2026-12-31", "2027-01-01", "2026-03-29", "2024-02-29"]) {
      expect(toIso(toLocalDate(iso))).toBe(iso);
    }
  });

  test("toLocalDate is local midnight of that calendar day, not a UTC instant", () => {
    const date = toLocalDate("2026-03-29");

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(29);
    expect(date.getHours()).toBe(0);
  });
});

describe("dayAriaLabel", () => {
  const monday = toLocalDate("2026-02-02");

  test("a free day is just its date", () => {
    const label = dayAriaLabel(monday, undefined);

    expect(label.includes("Monday")).toBe(true);
    expect(label.includes("2 February 2026")).toBe(true);
    expect(label.includes("request")).toBe(false);
  });

  test("a taken week says it already has a request and cannot be picked", () => {
    const label = dayAriaLabel(monday, "taken");

    expect(label.includes("2 February 2026")).toBe(true);
    expect(label.includes("week already has a request")).toBe(true);
    expect(label.includes("unavailable")).toBe(true);
  });

  test("a fulfilled week says a new request would be an addition", () => {
    const label = dayAriaLabel(monday, "fulfilled");

    expect(label.includes("2 February 2026")).toBe(true);
    expect(label.includes("week has a fulfilled request")).toBe(true);
    expect(label.includes("addition")).toBe(true);
    expect(label.includes("unavailable")).toBe(false);
  });
});

describe("daysOfWeeks", () => {
  test("expands each Monday to its seven local days, in order", () => {
    const days = daysOfWeeks(["2026-02-02", "2026-02-16"]);

    expect(days.map(toIso)).toEqual([
      ...weekDates("2026-02-02"),
      ...weekDates("2026-02-16"),
    ]);
  });

  test("a week crossing a DST change still yields seven distinct consecutive days", () => {
    const days = daysOfWeeks(["2026-03-23"]).map(toIso);

    expect(days).toEqual(weekDates("2026-03-23"));
    expect(days.at(-1)).toBe("2026-03-29");
  });

  test("no weeks, no days", () => {
    expect(daysOfWeeks([])).toEqual([]);
  });
});
