import {
  WidgetEmpty,
  WidgetError,
  WidgetFrame,
} from "@/components/dashboard/widget-frame";
import {
  loadAuditFeed,
  type AuditFeedEntry,
} from "@/lib/dashboard/audit-feed";
import {
  formatAbsoluteUtc,
  formatRelativeTime,
} from "@/lib/dashboard/relative-time";
import { loadSafely } from "@/lib/dashboard/safe";
import { WIDGET_TITLES, type WidgetProps } from "@/lib/dashboard/widgets";

function FeedRow({ entry, now }: { entry: AuditFeedEntry; now: Date }) {
  return (
    <li className="flex min-h-11 flex-col gap-0.5 py-2">
      <span className="font-medium">{entry.label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span>{entry.actorName}</span>
        {entry.locationName && <span>{entry.locationName}</span>}
        <time
          dateTime={entry.createdAt}
          title={formatAbsoluteUtc(entry.createdAt)}
        >
          {formatRelativeTime(entry.createdAt, now)}
        </time>
      </span>
    </li>
  );
}

export async function AuditFeedWidget({
  actor,
  now,
  load = (a) => loadAuditFeed(a),
}: WidgetProps & {
  load?: (actor: WidgetProps["actor"]) => Promise<AuditFeedEntry[]>;
}) {
  const title = WIDGET_TITLES.audit_feed;
  const result = await loadSafely("audit_feed", () => load(actor));
  if (!result.ok) return <WidgetError title={title} />;

  if (result.data.length === 0) {
    return (
      <WidgetFrame title={title}>
        <WidgetEmpty>No recent activity.</WidgetEmpty>
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame title={title}>
      <ul className="flex flex-col divide-y text-sm">
        {result.data.map((entry) => (
          <FeedRow key={entry.id} entry={entry} now={now} />
        ))}
      </ul>
    </WidgetFrame>
  );
}
