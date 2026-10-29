import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { LocationCoverage } from "@/lib/dashboard/roster-coverage";
import type { ScopeActor } from "@/types/session";

import { RosterCoverageWidget } from "./roster-coverage-widget";

const now = new Date("2026-07-01T00:00:00Z");

const ho: ScopeActor = { role: "ho", siteId: "site-1", siteLocationId: null };

const short: LocationCoverage = {
  locationId: "loc-1",
  locationName: "Cikarang",
  siteName: "Nestle",
  week: "2026-06-29",
  required: 40,
  filled: 34,
  deficit: 6,
};

const covered: LocationCoverage = {
  locationId: "loc-2",
  locationName: "Karawang",
  siteName: "Nestle",
  week: "2026-06-29",
  required: 25,
  filled: 25,
  deficit: 0,
};

async function render(data: LocationCoverage[]) {
  return renderToStaticMarkup(
    await RosterCoverageWidget({ actor: ho, now, load: async () => data }),
  );
}

describe("RosterCoverageWidget", () => {
  test("shows filled of required and the deficit per location", async () => {
    const html = await render([short, covered]);
    expect(html.includes("Roster coverage this week")).toBeTrue();
    expect(html.includes("Cikarang")).toBeTrue();
    expect(html.includes("34 of 40")).toBeTrue();
    expect(html.includes("Short by 6")).toBeTrue();
    expect(html.includes("Karawang")).toBeTrue();
    expect(html.includes("25 of 25")).toBeTrue();
  });

  test("a deficit of 0 reads as covered, a positive one never does", async () => {
    const full = await render([covered]);
    expect(full.includes("Covered")).toBeTrue();
    expect(full.includes("Short by")).toBeFalse();

    const gap = await render([short]);
    expect(gap.includes("Short by 6")).toBeTrue();
    expect(gap.includes("Covered")).toBeFalse();
  });

  test("a location with no requirement is neutral, not covered", async () => {
    const html = await render([
      { ...covered, required: 0, filled: 0, deficit: 0 },
    ]);
    expect(html.includes("No requirement")).toBeTrue();
    expect(html.includes("Covered")).toBeFalse();
    expect(html.includes("Short by")).toBeFalse();
    expect(html.includes("0 of 0")).toBeFalse();
    expect(html.includes("NaN")).toBeFalse();
  });

  test("each location links to its roster for the week", async () => {
    const html = await render([short]);
    expect(
      html.includes(
        'href="/dashboard/roster?week=2026-06-29&amp;locationId=loc-1"',
      ),
    ).toBeTrue();
  });

  test("no locations shows the empty state", async () => {
    const html = await render([]);
    expect(html.includes("No location to show.")).toBeTrue();
    expect(html.includes("<ul")).toBeFalse();
  });

  test("a throwing load renders the error card, not the error text", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(
        await RosterCoverageWidget({
          actor: ho,
          now,
          load: async () => {
            throw new Error("db down");
          },
        }),
      );
      expect(html.includes("Roster coverage this week")).toBeTrue();
      expect(html.includes("Couldn&#x27;t load this section.")).toBeTrue();
      expect(html.includes("db down")).toBeFalse();
    } finally {
      spy.mockRestore();
    }
  });
});
