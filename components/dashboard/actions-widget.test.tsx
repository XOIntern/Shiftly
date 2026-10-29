import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { LocationActions } from "@/lib/dashboard/actions";
import type { ScopeActor } from "@/types/session";

import { ActionsWidget } from "./actions-widget";

const now = new Date("2026-07-01T00:00:00Z");

const admin: ScopeActor = {
  role: "admin",
  siteId: "site-1",
  siteLocationId: "loc-1",
};
const ho: ScopeActor = { role: "ho", siteId: "site-1", siteLocationId: null };

function location(
  overrides: Partial<LocationActions> & { locationId: string },
): LocationActions {
  return {
    locationName: "Cikarang",
    siteName: "Nestle",
    today: "2026-07-01",
    attendance: null,
    weeklyDrafts: [],
    readyToGenerate: [],
    openRequests: { weekly: 0, daily: 0, oldestAgeDays: null },
    ...overrides,
  };
}

// One todo (attendance today) and one info (open requests, admin view).
const busy = location({
  locationId: "loc-1",
  locationName: "Cikarang",
  attendance: { today: 3, incomplete: { count: 0, oldest: null } },
  openRequests: { weekly: 1, daily: 0, oldestAgeDays: 2 },
});

const quiet = location({ locationId: "loc-2", locationName: "Karawang" });

async function render(actor: ScopeActor, data: LocationActions[]) {
  return renderToStaticMarkup(
    await ActionsWidget({ actor, now, load: async () => data }),
  );
}

describe("ActionsWidget", () => {
  test("renders items as links with the exact hrefs", async () => {
    const html = await render(admin, [busy]);
    expect(html.includes("Needs action")).toBeTrue();
    expect(
      html.includes(
        'href="/dashboard/attendance?location=loc-1&amp;date=2026-07-01"',
      ),
    ).toBeTrue();
    expect(
      html.includes('href="/dashboard/requests?status=open&amp;type=weekly"'),
    ).toBeTrue();
    expect(html.includes("3 workers not recorded today")).toBeTrue();
  });

  test("todo and info are distinguishable by text, not colour alone", async () => {
    const html = await render(admin, [busy]);
    const items = html.split("<li").slice(1);
    const todo = items.find((li) => li.includes("not recorded today"))!;
    const info = items.find((li) => li.includes("waiting for HO"))!;
    expect(todo.includes("To do:")).toBeTrue();
    expect(todo.includes("For information:")).toBeFalse();
    expect(info.includes("For information:")).toBeTrue();
    expect(info.includes("To do:")).toBeFalse();
    expect(todo.includes("font-medium")).toBeTrue();
    expect(info.includes("font-medium")).toBeFalse();
  });

  test("an HO's open requests are todo", async () => {
    const html = await render(ho, [
      location({
        locationId: "loc-1",
        openRequests: { weekly: 2, daily: 0, oldestAgeDays: 0 },
      }),
    ]);
    expect(html.includes("To do:")).toBeTrue();
    expect(html.includes("For information:")).toBeFalse();
  });

  test("no locations shows the empty state", async () => {
    const html = await render(admin, []);
    expect(html.includes("Nothing needs your attention.")).toBeTrue();
    expect(html.includes("<ul")).toBeFalse();
  });

  test("locations with zero items show the empty state", async () => {
    const html = await render(admin, [quiet]);
    expect(html.includes("Nothing needs your attention.")).toBeTrue();
  });

  test("a throwing load renders the error card, not the error text", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = renderToStaticMarkup(
        await ActionsWidget({
          actor: admin,
          now,
          load: async () => {
            throw new Error("db down");
          },
        }),
      );
      expect(html.includes("Needs action")).toBeTrue();
      expect(html.includes("Couldn&#x27;t load this section.")).toBeTrue();
      expect(html.includes("db down")).toBeFalse();
    } finally {
      spy.mockRestore();
    }
  });

  test("location names show only when more than one location is loaded", async () => {
    const one = await render(admin, [busy]);
    expect(one.includes("Cikarang")).toBeFalse();

    // Only one of the two loaded locations has items; names still show.
    const two = await render(admin, [busy, quiet]);
    expect(two.includes("Cikarang")).toBeTrue();
  });

  test("a role outside admin and ho shows the empty state", async () => {
    const html = await render(
      { role: "superadmin", siteId: null, siteLocationId: null },
      [busy],
    );
    expect(html.includes("Nothing needs your attention.")).toBeTrue();
    expect(html.includes("<a ")).toBeFalse();
  });
});
