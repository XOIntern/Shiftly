import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { LocationAttendance } from "@/lib/dashboard/attendance-today";
import type { ScopeActor } from "@/types/session";

import { AttendanceTodayWidget } from "./attendance-today-widget";

const now = new Date("2026-07-01T00:00:00Z");

const admin: ScopeActor = {
  role: "admin",
  siteId: "site-1",
  siteLocationId: "loc-1",
};

const entry: LocationAttendance = {
  locationId: "loc-1",
  locationName: "Cikarang",
  today: "2026-07-01",
  summary: {
    scheduled: 20,
    presentScheduled: 11,
    present: 12,
    leave: 3,
    sick: 4,
    absent: 5,
    unrecorded: 6,
    unscheduled: 7,
  },
};

async function render(data: LocationAttendance[]) {
  return renderToStaticMarkup(
    await AttendanceTodayWidget({ actor: admin, now, load: async () => data }),
  );
}

// The number rendered next to a label, read from its <div> pair.
function countOf(html: string, label: string): string | undefined {
  return new RegExp(`${label}</dt><dd[^>]*>(\\d+)</dd>`).exec(html)?.[1];
}

describe("AttendanceTodayWidget", () => {
  test("renders the six counts under their labels", async () => {
    const html = await render([entry]);
    expect(html.includes("Attendance today")).toBeTrue();
    expect(countOf(html, "Present")).toBe("12");
    expect(countOf(html, "Leave")).toBe("3");
    expect(countOf(html, "Sick")).toBe("4");
    expect(countOf(html, "Absent")).toBe("5");
    expect(countOf(html, "Not recorded")).toBe("6");
    expect(countOf(html, "Unscheduled")).toBe("7");
  });

  test("no locations shows the empty state", async () => {
    const html = await render([]);
    expect(html.includes("No location to show.")).toBeTrue();
    expect(html.includes("<dl")).toBeFalse();
  });

  test("a throwing load renders the error card, not the error text", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(
        await AttendanceTodayWidget({
          actor: admin,
          now,
          load: async () => {
            throw new Error("db down");
          },
        }),
      );
      expect(html.includes("Attendance today")).toBeTrue();
      expect(html.includes("Couldn&#x27;t load this section.")).toBeTrue();
      expect(html.includes("db down")).toBeFalse();
    } finally {
      spy.mockRestore();
    }
  });

  test("location names show only when more than one location is loaded", async () => {
    const one = await render([entry]);
    expect(one.includes("Cikarang")).toBeFalse();

    const two = await render([
      entry,
      { ...entry, locationId: "loc-2", locationName: "Karawang" },
    ]);
    expect(two.includes("Cikarang")).toBeTrue();
    expect(two.includes("Karawang")).toBeTrue();
  });
});
