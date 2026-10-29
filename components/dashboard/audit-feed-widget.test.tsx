import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { AuditFeedEntry } from "@/lib/dashboard/audit-feed";
import type { ScopeActor } from "@/types/session";

import { AuditFeedWidget } from "./audit-feed-widget";

const now = new Date("2026-07-01T12:00:00Z");

const ho: ScopeActor = { role: "ho", siteId: "site-1", siteLocationId: null };

const entry: AuditFeedEntry = {
  id: "a-1",
  action: "roster.publish",
  label: "Published a roster",
  actorName: "Dewi Lestari",
  locationName: "Cikarang",
  createdAt: "2026-07-01T11:55:00.000Z",
};

async function render(data: AuditFeedEntry[]) {
  return renderToStaticMarkup(
    await AuditFeedWidget({ actor: ho, now, load: async () => data }),
  );
}

describe("AuditFeedWidget", () => {
  test("an entry shows label, actor, location and a relative time", async () => {
    const html = await render([entry]);
    expect(html.includes("Recent activity")).toBeTrue();
    expect(html.includes("Published a roster")).toBeTrue();
    expect(html.includes("Dewi Lestari")).toBeTrue();
    expect(html.includes("Cikarang")).toBeTrue();
    expect(html.includes("5 min ago")).toBeTrue();
  });

  test("the time is a <time> element with the ISO value and an absolute title", async () => {
    const html = await render([entry]);
    expect(html).toContain('<time dateTime="2026-07-01T11:55:00.000Z"');
    expect(html).toContain('title="1 Jul 2026, 11:55 UTC"');
  });

  test("entries render as a list, in the order given", async () => {
    const html = await render([
      entry,
      {
        ...entry,
        id: "a-2",
        label: "Corrected attendance",
        actorName: "Budi",
        createdAt: "2026-06-29T12:00:00.000Z",
      },
    ]);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.includes("<ul")).toBeTrue();
    expect(html.indexOf("Published a roster")).toBeLessThan(
      html.indexOf("Corrected attendance"),
    );
    expect(html.includes("2 days ago")).toBeTrue();
  });

  test("a null location renders no location", async () => {
    const html = await render([{ ...entry, locationName: null }]);
    expect(html.includes("Cikarang")).toBeFalse();
    expect(html.includes("null")).toBeFalse();
  });

  test("the raw action string is not in the markup", async () => {
    const html = await render([entry]);
    expect(html.includes("roster.publish")).toBeFalse();
  });

  test("no entries shows the empty state", async () => {
    const html = await render([]);
    expect(html.includes("No recent activity.")).toBeTrue();
    expect(html.includes("<ul")).toBeFalse();
  });

  test("a throwing load renders the error card, not the error text", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(
        await AuditFeedWidget({
          actor: ho,
          now,
          load: async () => {
            throw new Error("db down");
          },
        }),
      );
      expect(html.includes("Recent activity")).toBeTrue();
      expect(html.includes("Couldn&#x27;t load this section.")).toBeTrue();
      expect(html.includes("db down")).toBeFalse();
    } finally {
      spy.mockRestore();
    }
  });
});
