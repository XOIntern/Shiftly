import { CircleAlertIcon, InfoIcon } from "lucide-react";
import Link from "next/link";

import {
  WidgetEmpty,
  WidgetError,
  WidgetFrame,
} from "@/components/dashboard/widget-frame";
import {
  actionItemsFor,
  loadActions,
  type ActionItem,
  type LocationActions,
} from "@/lib/dashboard/actions";
import { loadSafely } from "@/lib/dashboard/safe";
import { WIDGET_TITLES, type WidgetProps } from "@/lib/dashboard/widgets";

// A todo is work for this role (bold, alert icon); info is something the role
// only needs to know (regular weight, muted, info icon). The screen-reader
// prefix carries the same distinction, so colour is never the only cue.
function ActionRow({
  item,
  showLocation,
}: {
  item: ActionItem;
  showLocation: boolean;
}) {
  const todo = item.kind === "todo";
  const Icon = todo ? CircleAlertIcon : InfoIcon;

  return (
    <li>
      <Link
        href={item.href}
        className="-mx-2 flex min-h-11 items-start gap-3 rounded-md px-2 py-2 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Icon
          aria-hidden="true"
          className={
            todo
              ? "mt-0.5 size-4 shrink-0 text-foreground"
              : "mt-0.5 size-4 shrink-0 text-muted-foreground"
          }
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className={
              todo ? "font-medium" : "font-normal text-muted-foreground"
            }
          >
            <span className="sr-only">
              {todo ? "To do: " : "For information: "}
            </span>
            {item.label}
          </span>
          {showLocation && (
            <span className="text-xs text-muted-foreground">
              {item.locationName}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

// The role check is defensive: widgetsFor keeps superadmin away from this
// widget, and a role without an item set must not crash the dashboard.
function itemsFor(
  data: LocationActions[],
  role: WidgetProps["actor"]["role"],
): ActionItem[] {
  return role === "admin" || role === "ho" ? actionItemsFor(data, role) : [];
}

export async function ActionsWidget({
  actor,
  now,
  load = loadActions,
}: WidgetProps & {
  load?: (actor: WidgetProps["actor"], now: Date) => Promise<LocationActions[]>;
}) {
  const title = WIDGET_TITLES.actions;
  const result = await loadSafely("actions", () => load(actor, now));
  if (!result.ok) return <WidgetError title={title} />;

  const items = itemsFor(result.data, actor.role);
  if (items.length === 0) {
    return (
      <WidgetFrame title={title}>
        <WidgetEmpty>Nothing needs your attention.</WidgetEmpty>
      </WidgetFrame>
    );
  }

  const showLocation = result.data.length > 1;

  return (
    <WidgetFrame title={title}>
      <ul className="flex flex-col text-sm">
        {items.map((item) => (
          <ActionRow key={item.key} item={item} showLocation={showLocation} />
        ))}
      </ul>
    </WidgetFrame>
  );
}
