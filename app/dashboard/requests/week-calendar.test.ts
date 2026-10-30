import { describe, expect, test } from "bun:test";

import { dayNumber } from "@/lib/dates";
import { weekDates } from "@/lib/week";
import type { RequestedWeek } from "@/types/mp-request";

import {
  calendarDayAriaLabel,
  daysOfWeeks,
  markedWeeks,
  toIso,
  toLocalDate,
  weekDayRange,
} from "./week-calendar";

describe("markedWeeks", () => {
  test("maps approved weeks to taken and fulfilled-only weeks to fulfilled", () => {
    const marks = markedWeeks([
      { weekStart: "2026-02-02", status: "approved" },
      { weekStart: "2026-02-09", status: "approved" },
      { weekStart: "2026-02-16", status: "fulfilled" },
    ]);

    expect([...marks]).toEqual([
      ["2026-02-02", "taken"],
      ["2026-02-09", "taken"],
      ["2026-02-16", "fulfilled"],
    ]);
  });

  test("a week holding both a fulfilled and an approved request is taken whichever comes first", () => {
    const fulfilled: RequestedWeek = { weekStart: "2026-03-02", status: "fulfilled" };
    const approved: RequestedWeek = { weekStart: "2026-03-02", status: "approved" };

    expect(markedWeeks([fulfilled, approved]).get("2026-03-02")).toBe("taken");
    expect(markedWeeks([approved, fulfilled]).get("2026-03-02")).toBe("taken");
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

describe("calendarDayAriaLabel", () => {
  const day = toLocalDate("2026-10-14");
  const date = "Wednesday, 14 October 2026";

  test("a day with nothing around it is just its date", () => {
    expect(calendarDayAriaLabel(day, { hasDaily: false, blocks: null })).toBe(date);
  });

  test("informational marks name what the week and the day hold, and nothing is unavailable", () => {
    expect(
      calendarDayAriaLabel(day, { weekMark: "taken", hasDaily: false, blocks: null }),
    ).toBe(`${date}, week has an open or approved request`);
    expect(
      calendarDayAriaLabel(day, { weekMark: "fulfilled", hasDaily: false, blocks: null }),
    ).toBe(`${date}, week has a fulfilled request`);
    expect(calendarDayAriaLabel(day, { hasDaily: true, blocks: null })).toBe(
      `${date}, daily request open`,
    );
  });

  test("a daily request inside a marked week reports both, week first", () => {
    expect(
      calendarDayAriaLabel(day, { weekMark: "fulfilled", hasDaily: true, blocks: null }),
    ).toBe(`${date}, week has a fulfilled request, daily request open`);
  });

  test("where weeks block (the weekly form) a taken week is unavailable and a fulfilled one is an addition", () => {
    expect(
      calendarDayAriaLabel(day, { weekMark: "taken", hasDaily: false, blocks: "week" }),
    ).toBe(`${date}, week already has a request, unavailable`);
    expect(
      calendarDayAriaLabel(day, { weekMark: "fulfilled", hasDaily: false, blocks: "week" }),
    ).toBe(`${date}, week has a fulfilled request, a new request is an addition`);
  });

  test("where days block (the daily form) a day with a daily request is unavailable while its week stays informational", () => {
    expect(
      calendarDayAriaLabel(day, { weekMark: "taken", hasDaily: true, blocks: "day" }),
    ).toBe(
      `${date}, week has an open or approved request, day already has a request, unavailable`,
    );
  });

  test("a daily request is only called unavailable where days block", () => {
    expect(
      calendarDayAriaLabel(day, { hasDaily: true, blocks: "week" }).includes("unavailable"),
    ).toBe(false);
  });
});
