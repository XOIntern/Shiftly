import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { SiteOption, SiteLocationOption, WorkAreaRow } from "@/types/forms";
import { WorkAreaForm, siteLocationOptionsFor } from "./work-area-form";

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
