import Link from "next/link";
import { cn } from "cn";

import type { SitesView } from "@/lib/sites-view";

const BASE = "/dashboard/sites";

// A tab switch keeps the search term and restarts at page 1; sort and page
// size belong to the table that is being left, so they are not carried over.
function hrefFor(view: SitesView, q: string): string {
  const params = new URLSearchParams();
  if (view === "deleted") params.set("view", "deleted");
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `${BASE}?${query}` : BASE;
}

const TABS: Array<{ view: SitesView; label: string }> = [
  { view: "active", label: "Active" },
  { view: "deleted", label: "Deleted" },
];

export function SitesViewTabs({ view, q }: { view: SitesView; q: string }) {
  return (
    <nav aria-label="Site list view" className="flex gap-1">
      {TABS.map((tab) => {
        const current = tab.view === view;
        return (
          <Link
            key={tab.view}
            href={hrefFor(tab.view, q)}
            aria-current={current ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              current
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
