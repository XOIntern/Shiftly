import { Suspense, type ComponentType } from "react";
import { cn } from "cn";

import { ActionsWidget } from "@/components/dashboard/actions-widget";
import { AttendanceTodayWidget } from "@/components/dashboard/attendance-today-widget";
import { AuditFeedWidget } from "@/components/dashboard/audit-feed-widget";
import { LocationOverviewWidget } from "@/components/dashboard/location-overview-widget";
import { QuickActionsWidget } from "@/components/dashboard/quick-actions-widget";
import { RosterCoverageWidget } from "@/components/dashboard/roster-coverage-widget";
import { WidgetSkeleton } from "@/components/dashboard/widget-frame";
import {
  WIDGET_TITLES,
  widgetColumns,
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
  const { strip, main, side } = widgetColumns(actor.role);
  if (strip.length + main.length + side.length === 0) return null;

  const renderWidget = (key: WidgetKey) => {
    const Widget = REGISTRY[key];
    return (
      <Suspense
        key={key}
        fallback={<WidgetSkeleton title={WIDGET_TITLES[key]} />}
      >
        <Widget actor={actor} now={now} />
      </Suspense>
    );
  };

  // With a side column the main widgets stack in one column beside it. Alone,
  // they share the row as two columns once the page is wide enough.
  const hasSide = side.length > 0;

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      {strip.map(renderWidget)}
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          hasSide && "@5xl/main:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
        )}
      >
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            !hasSide && "@3xl/main:grid-cols-2",
          )}
        >
          {main.map(renderWidget)}
        </div>
        {hasSide && (
          <div className="grid grid-cols-1 gap-4">{side.map(renderWidget)}</div>
        )}
      </div>
    </div>
  );
}
