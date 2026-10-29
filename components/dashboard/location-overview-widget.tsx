import {
  WidgetEmpty,
  WidgetError,
  WidgetFrame,
} from "@/components/dashboard/widget-frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadSafely } from "@/lib/dashboard/safe";
import {
  loadLocationOverview,
  type LocationOverviewRow,
  type RosterWeekStatus,
} from "@/lib/dashboard/location-overview";
import { WIDGET_TITLES, type WidgetProps } from "@/lib/dashboard/widgets";

const ROSTER_LABELS: Record<RosterWeekStatus, string> = {
  none: "No roster",
  draft: "Draft",
  published: "Published",
};

type SiteGroup = { siteId: string; siteName: string; rows: LocationOverviewRow[] };

// The loader orders by site then location, so consecutive rows of one site
// form its group.
function groupBySite(rows: LocationOverviewRow[]): SiteGroup[] {
  const groups: SiteGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.siteId === row.siteId) last.rows.push(row);
    else groups.push({ siteId: row.siteId, siteName: row.siteName, rows: [row] });
  }
  return groups;
}

function SiteTable({ group }: { group: SiteGroup }) {
  const headingId = `location-overview-${group.siteId}`;

  return (
    <section className="flex flex-col gap-1">
      <h3 id={headingId} className="text-sm font-medium">
        {group.siteName}
      </h3>
      <Table aria-labelledby={headingId}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Location</TableHead>
            <TableHead scope="col" className="text-right">
              Workers
            </TableHead>
            <TableHead scope="col" className="text-right">
              Present / scheduled
            </TableHead>
            <TableHead scope="col">Roster</TableHead>
            <TableHead scope="col" className="text-right">
              Open daily requests
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.rows.map((row) => (
            <TableRow key={row.locationId}>
              <TableHead scope="row" className="text-foreground">
                {row.locationName}
              </TableHead>
              <TableCell className="text-right tabular-nums">
                {row.activeWorkers}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.presentToday} / {row.scheduledToday}
              </TableCell>
              <TableCell>{ROSTER_LABELS[row.rosterStatus]}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.openRequests}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

export async function LocationOverviewWidget({
  actor,
  now,
  load = loadLocationOverview,
}: WidgetProps & {
  load?: (
    actor: WidgetProps["actor"],
    now: Date,
  ) => Promise<LocationOverviewRow[]>;
}) {
  const title = WIDGET_TITLES.location_overview;
  const result = await loadSafely("location_overview", () => load(actor, now));
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
      <div className="flex flex-col gap-5">
        {groupBySite(result.data).map((group) => (
          <SiteTable key={group.siteId} group={group} />
        ))}
      </div>
    </WidgetFrame>
  );
}
