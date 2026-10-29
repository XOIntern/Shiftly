import { describe, expect, test } from "bun:test";

import { WIDGET_TITLES, widgetsFor } from "./widgets";

const ROLES = ["superadmin", "ho", "admin"] as const;

describe("widgetsFor", () => {
  test("superadmin never gets the needs-action widget", () => {
    expect(widgetsFor("superadmin")).not.toContain("actions");
  });

  test("admin never gets the HO and superadmin oversight widgets", () => {
    const keys = widgetsFor("admin") as string[];
    expect(keys.includes("audit_feed")).toBeFalse();
    expect(keys.includes("location_overview")).toBeFalse();
    expect(keys.includes("roster_coverage")).toBeFalse();
  });

  test("ho gets roster coverage and the locations overview", () => {
    expect(widgetsFor("ho")).toContain("roster_coverage");
    expect(widgetsFor("ho")).toContain("location_overview");
  });

  test("superadmin gets only the locations overview", () => {
    expect(widgetsFor("superadmin")).toEqual(["location_overview"]);
  });

  test("the HO sees needs action, roster coverage, then locations", () => {
    expect(widgetsFor("ho")).toEqual([
      "actions",
      "roster_coverage",
      "location_overview",
    ]);
  });

  test("admin and HO get the needs-action widget", () => {
    expect(widgetsFor("admin")).toContain("actions");
    expect(widgetsFor("ho")).toContain("actions");
  });

  test("only the admin gets the attendance-today widget", () => {
    expect(widgetsFor("admin")).toContain("attendance_today");
    expect(widgetsFor("ho")).not.toContain("attendance_today");
    expect(widgetsFor("superadmin")).not.toContain("attendance_today");
  });

  test("the admin sees needs action, attendance today, then quick actions", () => {
    expect(widgetsFor("admin")).toEqual([
      "actions",
      "attendance_today",
      "quick_actions",
    ]);
  });

  test("every returned key has a title", () => {
    for (const role of ROLES) {
      for (const key of widgetsFor(role)) {
        expect(WIDGET_TITLES[key].length).toBeGreaterThan(0);
      }
    }
    expect(WIDGET_TITLES.actions).toBe("Needs action");
    expect(WIDGET_TITLES.attendance_today).toBe("Attendance today");
    expect(WIDGET_TITLES.quick_actions).toBe("Quick actions");
    expect(WIDGET_TITLES.roster_coverage).toBe("Roster coverage this week");
    expect(WIDGET_TITLES.location_overview).toBe("Locations");
  });
});
