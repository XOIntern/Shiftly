import { describe, expect, test } from "bun:test";

import { isMonday, mondayOf, weekDates } from "./week";

describe("mondayOf", () => {
  test("maps Thursday onto its Monday", () => {
    expect(mondayOf("2026-10-22")).toBe("2026-10-19");
  });

  test("is idempotent on a Monday", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
  });
});

describe("isMonday", () => {
  test("accepts a Monday, rejects the next day", () => {
    expect(isMonday("2026-10-19")).toBe(true);
    expect(isMonday("2026-10-20")).toBe(false);
  });
});

describe("weekDates", () => {
  test("returns the 7 dates of the Monday-start week, ascending", () => {
    expect(weekDates("2026-10-19")).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
  });
});
