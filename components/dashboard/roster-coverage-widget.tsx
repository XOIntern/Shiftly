import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleMinusIcon,
} from "lucide-react";
import Link from "next/link";

import {
  WidgetEmpty,
  WidgetError,
  WidgetFrame,
} from "@/components/dashboard/widget-frame";
import { loadSafely } from "@/lib/dashboard/safe";
import {
  loadRosterCoverage,
  type LocationCoverage,
} from "@/lib/dashboard/roster-coverage";
import { WIDGET_TITLES, type WidgetProps } from "@/lib/dashboard/widgets";

// Covered, short and no requirement differ in icon and wording as well as
// weight, so the state never rests on colour.
function CoverageRow({ entry }: { entry: LocationCoverage }) {
  const noRequirement = entry.required === 0;
  const covered = entry.deficit <= 0;
  const Icon = noRequirement
    ? CircleMinusIcon
    : covered
      ? CircleCheckIcon
      : CircleAlertIcon;

  return (
    <li>
      <Link
        href={`/dashboard/roster?week=${entry.week}&locationId=${entry.locationId}`}
        className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{entry.locationName}</span>
          {noRequirement ? null : (
            <span className="text-xs tabular-nums text-muted-foreground">
              {entry.filled} of {entry.required} filled
            </span>
          )}
        </span>
        <span
          className={
            covered || noRequirement
              ? "flex shrink-0 items-center gap-1.5 text-muted-foreground"
              : "flex shrink-0 items-center gap-1.5 font-medium"
          }
        >
          <Icon aria-hidden="true" className="size-4" />
          {noRequirement
            ? "No requirement"
            : covered
              ? "Covered"
              : `Short by ${entry.deficit}`}
        </span>
      </Link>
    </li>
  );
}

export async function RosterCoverageWidget({
  actor,
  now,
  load = loadRosterCoverage,
}: WidgetProps & {
  load?: (actor: WidgetProps["actor"], now: Date) => Promise<LocationCoverage[]>;
}) {
  const title = WIDGET_TITLES.roster_coverage;
  const result = await loadSafely("roster_coverage", () => load(actor, now));
  if (!result.ok) return <WidgetError title={title} />;

  if (result.data.length === 0) {
    return (
      <WidgetFrame title={title}>
        <WidgetEmpty>No location to show.</WidgetEmpty>
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame title={title}>
      <ul className="flex flex-col text-sm">
        {result.data.map((entry) => (
          <CoverageRow key={entry.locationId} entry={entry} />
        ))}
      </ul>
    </WidgetFrame>
  );
}
