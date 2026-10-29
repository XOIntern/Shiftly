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
  });

  test("admin and HO get the needs-action widget", () => {
    expect(widgetsFor("admin")).toContain("actions");
    expect(widgetsFor("ho")).toContain("actions");
  });

  test("only the admin gets the attendance-today widget", () => {
    expect(widgetsFor("admin")).toContain("attendance_today");
    expect(widgetsFor("ho")).toEqual(["actions"]);
    expect(widgetsFor("superadmin")).toEqual([]);
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
  });
});
