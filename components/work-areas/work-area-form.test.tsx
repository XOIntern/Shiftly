import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as realNavigation from "next/navigation";

import type { PositionRow } from "@/types/position";
import type { SiteOption, SiteLocationOption } from "@/types/site";
import type { WorkAreaRow } from "@/types/work-area";
import {
  WorkAreaForm,
  siteLocationOptionsFor,
  validateWorkAreaForm,
} from "./work-area-form";

// The Positions link is a next/link; the navigation mock only stands in
// for the router context it reads during a static render. The real module
// is spread back in because bun's module mocks are process-wide.
mock.module("next/navigation", () => ({
  ...realNavigation,
}));

// Form fixtures: site A holds locations LA1/LA2, site B holds LB1. No DB —
// the dialog composes everything from the option props it receives.
const SITE_A = "11111111-1111-1111-1111-111111111111";
const SITE_B = "22222222-2222-2222-2222-222222222222";
const LOC_A1 = "aaaaaaaa-1111-1111-1111-111111111111";
const LOC_A2 = "aaaaaaaa-2222-2222-2222-222222222222";
const LOC_B1 = "bbbbbbbb-1111-1111-1111-111111111111";

const sites: SiteOption[] = [
  { id: SITE_A, name: "Site Alpha" },
  { id: SITE_B, name: "Site Beta" },
];
const allLocations: SiteLocationOption[] = [
  { id: LOC_A1, name: "Loc Alpha One", siteId: SITE_A },
  { id: LOC_A2, name: "Loc Alpha Two", siteId: SITE_A },
  { id: LOC_B1, name: "Loc Beta One", siteId: SITE_B },
];

function renderForm(props: {
  positions?: PositionRow[];
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  pinnedLocationName?: string;
  workArea?: WorkAreaRow;
}) {
  return renderToStaticMarkup(
    <WorkAreaForm {...props} onSaved={() => {}} />,
  );
}

// t7- suite: the form's site→location cascading select (issue: superadmin
// sees loations of every site mixed in one flat dropdown).
describe("siteLocationOptionsFor", () => {
  test("no site picked keeps every option", () => {
    const options = siteLocationOptionsFor(allLocations, null);

    expect(options.map((o) => o.id)).toEqual([LOC_A1, LOC_A2, LOC_B1]);
  });

  test("a picked site keeps only its own locations", () => {
    const options = siteLocationOptionsFor(allLocations, SITE_B);

    expect(options.map((o) => o.id)).toEqual([LOC_B1]);
  });
});

describe("WorkAreaForm site select", () => {
  test("create with multiple sites: Site field renders and location is locked until a site is picked", () => {
    const html = renderForm({ siteLocations: allLocations, sites });

    expect(html.includes(">Site<")).toBeTrue();
    expect(html.includes("Select a site first")).toBeTrue();
  });

  test("edit: the site select is pre-set to the work area's site", () => {
    const html = renderForm({
      siteLocations: allLocations,
      sites,
      workArea: {
        id: "cccccccc-1111-1111-1111-111111111111",
        name: "Zone 1",
        isActive: true,
        siteLocationId: LOC_A1,
        siteId: SITE_A,
        siteName: "Site Alpha",
        positions: [],
      },
    });

    expect(html.includes("Site Alpha")).toBeTrue();
    expect(html.includes("Loc Alpha One")).toBeTrue();
    expect(html.includes("Select a site first")).toBeFalse();
  });

  test("pinned admin: no Site field, location stays pinned", () => {
    const html = renderForm({
      siteLocations: [allLocations[0]!],
      sites,
      pinnedLocationName: "Loc Alpha One",
    });

    expect(html.includes(">Site<")).toBeFalse();
    expect(html.includes("Loc Alpha One")).toBeTrue();
  });

  test("single site (a ho's scope): no Site field, location opens directly", () => {
    const html = renderForm({
      siteLocations: allLocations,
      sites: [sites[0]!],
    });

    expect(html.includes(">Site<")).toBeFalse();
    expect(html.includes("Select a location")).toBeTrue();
  });
});

const positionAt = (siteId: string, name: string): PositionRow => ({
  id: `${siteId.slice(0, 4)}0000-0000-4000-8000-${name.length
    .toString()
    .padStart(12, "0")}`,
  name,
  siteId,
  siteName: siteId === SITE_A ? "Site Alpha" : "Site Beta",
  isActive: true,
});

describe("WorkAreaForm required positions (create)", () => {
  // A pinned admin's location resolves at once, so the site (and thus the
  // position catalog slice) is known without any interaction.
  const pinned = {
    siteLocations: [allLocations[0]!],
    sites,
    pinnedLocationName: "Loc Alpha One",
  };

  test("create shows the Required positions field, marked required", () => {
    const html = renderForm({
      ...pinned,
      positions: [positionAt(SITE_A, "Picker")],
    });

    expect(html.includes("Required positions")).toBeTrue();
    expect(html.includes('aria-required="true"')).toBeTrue();
    expect(html.includes("Select positions")).toBeTrue();
    expect(html.includes("/dashboard/positions")).toBeFalse();
  });

  test("a site with no positions disables the picker and links to Positions", () => {
    const html = renderForm({
      ...pinned,
      // Only a foreign site's position: nothing admissible for site A.
      positions: [positionAt(SITE_B, "Foreign")],
    });

    expect(html.includes("No positions for this site yet")).toBeTrue();
    expect(html.includes('href="/dashboard/positions"')).toBeTrue();
  });

  test("no location picked yet: picker locked, no Positions link", () => {
    const html = renderForm({ siteLocations: allLocations, sites });

    expect(html.includes("Required positions")).toBeTrue();
    expect(html.includes("Select a location first")).toBeTrue();
    expect(html.includes("/dashboard/positions")).toBeFalse();
  });

  test("edit is unchanged: no required marker, no Positions link", () => {
    const html = renderForm({
      siteLocations: allLocations,
      sites,
      positions: [],
      workArea: {
        id: "cccccccc-1111-1111-1111-111111111111",
        name: "Zone 1",
        isActive: true,
        siteLocationId: LOC_A1,
        siteId: SITE_A,
        siteName: "Site Alpha",
        positions: [],
      },
    });

    expect(html.includes("Required positions")).toBeTrue();
    expect(html.includes('aria-required="true"')).toBeFalse();
    expect(html.includes("/dashboard/positions")).toBeFalse();
  });
});

describe("validateWorkAreaForm", () => {
  test("create without a location surfaces the location error", () => {
    expect(
      validateWorkAreaForm({ isEdit: false, locationValue: null, requiredPositionIds: ["x"] }),
    ).toEqual({ siteLocationId: "Location is required" });
  });

  test("create with an empty set is blocked with the at-least-one message", () => {
    expect(
      validateWorkAreaForm({ isEdit: false, locationValue: LOC_A1, requiredPositionIds: [] }),
    ).toEqual({ requiredPositionIds: "Select at least one position" });
  });

  test("create reports both errors together", () => {
    expect(
      validateWorkAreaForm({ isEdit: false, locationValue: null, requiredPositionIds: [] }),
    ).toEqual({
      siteLocationId: "Location is required",
      requiredPositionIds: "Select at least one position",
    });
  });

  test("create with a location and a position passes", () => {
    expect(
      validateWorkAreaForm({ isEdit: false, locationValue: LOC_A1, requiredPositionIds: ["x"] }),
    ).toBeUndefined();
  });

  test("edit may clear the set", () => {
    expect(
      validateWorkAreaForm({ isEdit: true, locationValue: LOC_A1, requiredPositionIds: [] }),
    ).toBeUndefined();
  });
});
