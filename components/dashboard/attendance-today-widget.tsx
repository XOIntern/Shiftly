import {
  WidgetEmpty,
  WidgetError,
  WidgetFrame,
} from "@/components/dashboard/widget-frame";
import {
  loadAttendanceToday,
  type LocationAttendance,
} from "@/lib/dashboard/attendance-today";
import { loadSafely } from "@/lib/dashboard/safe";
import type { DaySummary } from "@/lib/dashboard/day-data";
import { WIDGET_TITLES, type WidgetProps } from "@/lib/dashboard/widgets";

const COUNTS: { label: string; key: keyof DaySummary }[] = [
  { label: "Present", key: "present" },
  { label: "Leave", key: "leave" },
  { label: "Sick", key: "sick" },
  { label: "Absent", key: "absent" },
  { label: "Not recorded", key: "unrecorded" },
  { label: "Unscheduled", key: "unscheduled" },
];

// Each count is a labelled term, so a screen reader hears "Sick: 4" and the
// meaning never rests on position or colour.
function Summary({ summary }: { summary: DaySummary }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {COUNTS.map(({ label, key }) => (
        <div key={key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {summary[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export async function AttendanceTodayWidget({
  actor,
  now,
  load = loadAttendanceToday,
}: WidgetProps & {
  load?: (
    actor: WidgetProps["actor"],
    now: Date,
  ) => Promise<LocationAttendance[]>;
}) {
  const title = WIDGET_TITLES.attendance_today;
  const result = await loadSafely("attendance_today", () => load(actor, now));
  if (!result.ok) return <WidgetError title={title} />;

  if (result.data.length === 0) {
    return (
      <WidgetFrame title={title}>
        <WidgetEmpty>No location to show.</WidgetEmpty>
      </WidgetFrame>
    );
  }

  const showLocation = result.data.length > 1;

  return (
    <WidgetFrame title={title}>
      <div className="flex flex-col gap-5">
        {result.data.map((entry) => (
          <section key={entry.locationId} className="flex flex-col gap-2">
            {showLocation && (
              <h3 className="text-sm font-medium">{entry.locationName}</h3>
            )}
            <Summary summary={entry.summary} />
          </section>
        ))}
      </div>
    </WidgetFrame>
  );
}
