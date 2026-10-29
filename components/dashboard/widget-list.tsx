import { Suspense, type ComponentType } from "react";

import { ActionsWidget } from "@/components/dashboard/actions-widget";
import { AttendanceTodayWidget } from "@/components/dashboard/attendance-today-widget";
import { AuditFeedWidget } from "@/components/dashboard/audit-feed-widget";
import { LocationOverviewWidget } from "@/components/dashboard/location-overview-widget";
import { QuickActionsWidget } from "@/components/dashboard/quick-actions-widget";
import { RosterCoverageWidget } from "@/components/dashboard/roster-coverage-widget";
import { WidgetSkeleton } from "@/components/dashboard/widget-frame";
import {
  WIDGET_TITLES,
  widgetsFor,
  type WidgetKey,
  type WidgetProps,
} from "@/lib/dashboard/widgets";

// One entry per WIDGET_KEYS member. A widget is an (async) server component
// that renders its own WidgetFrame, or WidgetError when loadSafely fails.
const REGISTRY: Record<WidgetKey, ComponentType<WidgetProps>> = {
  actions: ActionsWidget,
  attendance_today: AttendanceTodayWidget,
  quick_actions: QuickActionsWidget,
  roster_coverage: RosterCoverageWidget,
  location_overview: LocationOverviewWidget,
  audit_feed: AuditFeedWidget,
};

// Sync on purpose: each widget streams in behind its own Suspense boundary, so
// a slow or failing one never holds back the page or its siblings.
export function WidgetList({ actor, now }: WidgetProps) {
  const keys = widgetsFor(actor.role);
  if (keys.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @3xl/main:grid-cols-2">
      {keys.map((key) => {
        const Widget = REGISTRY[key];
        return (
          <Suspense
            key={key}
            fallback={<WidgetSkeleton title={WIDGET_TITLES[key]} />}
          >
            <Widget actor={actor} now={now} />
          </Suspense>
        );
      })}
    </div>
  );
}
