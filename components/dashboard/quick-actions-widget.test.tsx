import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { QuickLink } from "@/lib/dashboard/quick-actions";
import type { ScopeActor } from "@/types/session";

import { QuickActionsWidget } from "./quick-actions-widget";

const now = new Date("2026-07-01T00:00:00Z");

const admin: ScopeActor = {
  role: "admin",
  siteId: "site-1",
  siteLocationId: "loc-1",
};

const links: QuickLink[] = [
  { label: "Create request", href: "/dashboard/requests/new" },
  {
    label: "Open this week's roster",
    href: "/dashboard/roster?week=2026-06-29&locationId=loc-1",
  },
  {
    label: "Record today's attendance",
    href: "/dashboard/attendance?location=loc-1&date=2026-07-01",
  },
];

async function render(data: QuickLink[]) {
  return renderToStaticMarkup(
    await QuickActionsWidget({ actor: admin, now, load: async () => data }),
  );
}

describe("QuickActionsWidget", () => {
  test("renders the three links in a list", async () => {
    const html = await render(links);
    expect(html.includes("Quick actions")).toBeTrue();
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html.includes('href="/dashboard/requests/new"')).toBeTrue();
    expect(
      html.includes(
        'href="/dashboard/roster?week=2026-06-29&amp;locationId=loc-1"',
      ),
    ).toBeTrue();
    expect(
      html.includes(
        'href="/dashboard/attendance?location=loc-1&amp;date=2026-07-01"',
      ),
    ).toBeTrue();
    expect(html.includes("Open this week&#x27;s roster")).toBeTrue();
    expect(html.includes("Record today&#x27;s attendance")).toBeTrue();
  });

  test("link classes keep the outline border and the layout overrides", async () => {
    const html = await render(links);
    const classes = [...html.matchAll(/<a [^>]*class="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(classes).toHaveLength(3);
    for (const cls of classes) {
      expect(cls.split(" ")).toContain("border-border");
      expect(cls.split(" ")).not.toContain("border-transparent");
      expect(cls.split(" ")).toContain("justify-start");
      expect(cls.split(" ")).toContain("px-3");
      expect(cls.split(" ")).toContain("min-h-11");
    }
  });

  test("no links shows the empty state", async () => {
    const html = await render([]);
    expect(html.includes("No location to show.")).toBeTrue();
    expect(html.includes("<a ")).toBeFalse();
  });

  test("a throwing load renders the error card, not the error text", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(
        await QuickActionsWidget({
          actor: admin,
          now,
          load: async () => {
            throw new Error("db down");
          },
        }),
      );
      expect(html.includes("Quick actions")).toBeTrue();
      expect(html.includes("Couldn&#x27;t load this section.")).toBeTrue();
      expect(html.includes("db down")).toBeFalse();
    } finally {
      spy.mockRestore();
    }
  });
});
