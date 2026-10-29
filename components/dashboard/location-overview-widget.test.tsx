import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { LocationOverviewRow } from "@/lib/dashboard/location-overview";
import type { ScopeActor } from "@/types/session";

import { LocationOverviewWidget } from "./location-overview-widget";

const now = new Date("2026-07-01T00:00:00Z");

const superadmin: ScopeActor = {
  role: "superadmin",
  siteId: null,
  siteLocationId: null,
};

const row: LocationOverviewRow = {
  locationId: "loc-1",
  locationName: "Cikarang",
  siteId: "site-1",
  siteName: "Nestle",
  activeWorkers: 48,
  presentToday: 31,
  scheduledToday: 37,
  rosterStatus: "published",
  openRequests: 5,
};

async function render(data: LocationOverviewRow[]) {
  return renderToStaticMarkup(
    await LocationOverviewWidget({
      actor: superadmin,
      now,
      load: async () => data,
    }),
  );
}

// Body rows only: the header row has <th> cells and no <td>.
function rowsOf(html: string): string[] {
  const all = html.match(/<tr[^>]*>.*?<\/tr>/g) ?? [];
  return all.filter((r) => r.includes("<td"));
}

describe("LocationOverviewWidget", () => {
  test("one row per location with the five values", async () => {
    const html = await render([
      row,
      {
        ...row,
        locationId: "loc-2",
        locationName: "Karawang",
        activeWorkers: 12,
        presentToday: 0,
        scheduledToday: 9,
        rosterStatus: "draft",
        openRequests: 0,
      },
    ]);
    expect(html.includes("Locations")).toBeTrue();
    const rows = rowsOf(html);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toContain("Cikarang");
    expect(rows[0]).toContain(">48<");
    expect(rows[0]).toContain("31 / 37");
    expect(rows[0]).toContain("Published");
    expect(rows[0]).toContain(">5<");

    expect(rows[1]).toContain("Karawang");
    expect(rows[1]).toContain(">12<");
    expect(rows[1]).toContain("0 / 9");
    expect(rows[1]).toContain("Draft");
    expect(rows[1]).toContain(">0<");
  });

  test("a distinct label for none, draft and published", async () => {
    const labels = new Set<string>();
    for (const [status, label] of [
      ["none", "No roster"],
      ["draft", "Draft"],
      ["published", "Published"],
    ] as const) {
      const html = await render([{ ...row, rosterStatus: status }]);
      expect(html.includes(label)).toBeTrue();
      labels.add(label);
    }
    expect(labels.size).toBe(3);
  });

  test("rows are grouped under a heading per site name", async () => {
    const html = await render([
      row,
      { ...row, locationId: "loc-2", locationName: "Karawang" },
      {
        ...row,
        locationId: "loc-3",
        locationName: "Surabaya",
        siteId: "site-2",
        siteName: "Danone",
      },
    ]);
    const headings = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(
      (m) => m[1],
    );
    expect(headings).toEqual(["Nestle", "Danone"]);
    expect(html.match(/<table/g)).toHaveLength(2);

    const danone = html.indexOf("Danone");
    expect(html.indexOf("Cikarang")).toBeLessThan(danone);
    expect(html.indexOf("Karawang")).toBeLessThan(danone);
    expect(html.indexOf("Surabaya")).toBeGreaterThan(danone);
  });

  test("a single location renders one row", async () => {
    const html = await render([row]);
    expect(rowsOf(html)).toHaveLength(1);
  });

  test("the table has column headers and a row header per location", async () => {
    const html = await render([row]);
    expect(html.includes('scope="col"')).toBeTrue();
    expect(html.includes('scope="row"')).toBeTrue();
  });

  test("the open-requests column is headed Open daily requests", async () => {
    const html = await render([row]);
    expect(html.includes("Open daily requests")).toBeTrue();
  });

  test("no locations shows the empty state", async () => {
    const html = await render([]);
    expect(html.includes("No location to show.")).toBeTrue();
    expect(html.includes("<table")).toBeFalse();
  });

  test("a throwing load renders the error card, not the error text", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(
        await LocationOverviewWidget({
          actor: superadmin,
          now,
          load: async () => {
            throw new Error("db down");
          },
        }),
      );
      expect(html.includes("Locations")).toBeTrue();
      expect(html.includes("Couldn&#x27;t load this section.")).toBeTrue();
      expect(html.includes("db down")).toBeFalse();
    } finally {
      spy.mockRestore();
    }
  });
});
