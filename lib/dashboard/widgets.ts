import type { ScopeActor } from "@/types/session";

// Each widget issue appends its key here, its title below, its role
// membership in widgetsFor, and one entry in components/dashboard/widget-list.
export const WIDGET_KEYS = [
  "actions",
  "attendance_today",
  "quick_actions",
  "roster_coverage",
  "location_overview",
  "audit_feed",
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

export const WIDGET_TITLES: Record<WidgetKey, string> = {
  actions: "Needs action",
  attendance_today: "Attendance today",
  quick_actions: "Quick actions",
  roster_coverage: "Roster coverage this week",
  location_overview: "Locations",
  audit_feed: "Recent activity",
};

export type WidgetProps = { actor: ScopeActor; now: Date };

// Which widgets a role sees, in render order.
export function widgetsFor(role: ScopeActor["role"]): WidgetKey[] {
  switch (role) {
    case "admin":
      return ["actions", "attendance_today", "quick_actions"];
    case "ho":
      return ["actions", "roster_coverage", "location_overview", "audit_feed"];
    case "superadmin":
      return ["location_overview", "audit_feed"];
  }
}
