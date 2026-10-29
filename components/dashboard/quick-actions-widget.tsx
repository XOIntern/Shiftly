import Link from "next/link";

import {
  WidgetEmpty,
  WidgetError,
  WidgetFrame,
} from "@/components/dashboard/widget-frame";
import { buttonVariants } from "@/components/ui/button";
import { loadSafely } from "@/lib/dashboard/safe";
import { loadQuickLinks, type QuickLink } from "@/lib/dashboard/quick-actions";
import { WIDGET_TITLES, type WidgetProps } from "@/lib/dashboard/widgets";

export async function QuickActionsWidget({
  actor,
  now,
  load = loadQuickLinks,
}: WidgetProps & {
  load?: (actor: WidgetProps["actor"], now: Date) => Promise<QuickLink[]>;
}) {
  const title = WIDGET_TITLES.quick_actions;
  const result = await loadSafely("quick_actions", () => load(actor, now));
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
      <ul className="flex flex-col gap-2">
        {result.data.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className={buttonVariants({
                variant: "outline",
                className: "min-h-11 w-full justify-start px-3",
              })}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}
