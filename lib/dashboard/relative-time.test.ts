import { describe, expect, test } from "bun:test";

import { formatAbsoluteUtc, formatRelativeTime } from "./relative-time";

const now = new Date("2026-07-01T12:00:00Z");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(now.getTime() - ms).toISOString();
}

describe("formatRelativeTime", () => {
  test("under a minute is just now", () => {
    expect(formatRelativeTime(ago(0), now)).toBe("just now");
    expect(formatRelativeTime(ago(59_999), now)).toBe("just now");
  });

  test("a future timestamp is clamped to just now", () => {
    expect(formatRelativeTime(ago(-5 * MIN), now)).toBe("just now");
  });

  test("minutes", () => {
    expect(formatRelativeTime(ago(MIN), now)).toBe("1 min ago");
    expect(formatRelativeTime(ago(5 * MIN), now)).toBe("5 min ago");
    expect(formatRelativeTime(ago(59 * MIN + 59_000), now)).toBe("59 min ago");
  });

  test("hours, singular and plural", () => {
    expect(formatRelativeTime(ago(HOUR), now)).toBe("1 hour ago");
    expect(formatRelativeTime(ago(3 * HOUR), now)).toBe("3 hours ago");
    expect(formatRelativeTime(ago(23 * HOUR + 59 * MIN), now)).toBe(
      "23 hours ago",
    );
  });

  test("days, singular and plural", () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe("1 day ago");
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe("2 days ago");
    expect(formatRelativeTime(ago(6 * DAY + 23 * HOUR), now)).toBe(
      "6 days ago",
    );
  });

  test("a week or older falls back to a UTC date", () => {
    expect(formatRelativeTime(ago(7 * DAY), now)).toBe("24 Jun 2026");
    expect(formatRelativeTime("2025-01-05T23:30:00Z", now)).toBe("5 Jan 2025");
  });
});

describe("formatAbsoluteUtc", () => {
  test("renders date and time in UTC", () => {
    expect(formatAbsoluteUtc("2026-06-12T14:05:09Z")).toBe(
      "12 Jun 2026, 14:05 UTC",
    );
    expect(formatAbsoluteUtc("2026-01-02T03:04:00Z")).toBe(
      "2 Jan 2026, 03:04 UTC",
    );
  });
});
