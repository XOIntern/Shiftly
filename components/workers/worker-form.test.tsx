import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  PositionRow,
  SiteOption,
  SiteLocationOption,
  WorkerRow,
} from "@/types/forms";
import { WorkerForm, positionOptionsFor } from "./worker-form";

// Form fixtures: site A holds locations LA1/LA2 and positions PA1/PA2 (PA2
// inactive), site B holds LB and PB. No DB — the dialog composes everything
// from the option props it receives; the page pre-filters, the form filters
// isActive defensively inside positionOptionsFor.
const SITE_A = "11111111-1111-1111-1111-111111111111";
const SITE_B = "22222222-2222-2222-2222-222222222222";
const LOC_A1 = "aaaaaaaa-1111-1111-1111-111111111111";
const LOC_A2 = "aaaaaaaa-2222-2222-2222-222222222222";
const LOC_B1 = "bbbbbbbb-1111-1111-1111-111111111111";
const POS_A1 = "aaaaaaaa-1111-1111-1111-111111111111";
const POS_A2 = "aaaaaaaa-2222-2222-2222-222222222222";
const POS_B1 = "bbbbbbbb-1111-1111-1111-111111111111";

const sites: SiteOption[] = [
  { id: SITE_A, name: "Site Alpha" },
  { id: SITE_B, name: "Site Beta" },
];
const allLocations: SiteLocationOption[] = [
  { id: LOC_A1, name: "Loc Alpha One", siteId: SITE_A },
  { id: LOC_A2, name: "Loc Alpha Two", siteId: SITE_A },
  { id: LOC_B1, name: "Loc Beta One", siteId: SITE_B },
];
const allPositions: PositionRow[] = [
  {
    id: POS_A1,
    name: "Position Alpha One",
    isActive: true,
    siteId: SITE_A,
    siteName: "Site Alpha",
  },
  {
    id: POS_A2,
    name: "Position Alpha Two",
    isActive: false,
    siteId: SITE_A,
    siteName: "Site Alpha",
  },
  {
    id: POS_B1,
    name: "Position Beta One",
    isActive: true,
    siteId: SITE_B,
    siteName: "Site Beta",
  },
];

const editWorker: WorkerRow = {
  id: "cccccccc-1111-1111-1111-111111111111",
  employeeId: "EMP-001",
  name: "Budi Santoso",
  isActive: true,
  contractEndDate: null,
  siteLocationId: LOC_A1,
  positionId: POS_A1,
  siteId: SITE_A,
  siteName: "Site Alpha",
  locationName: "Loc Alpha One",
  positionName: "Position Alpha One",
};

function renderForm(props: {
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  positions: PositionRow[];
  pinnedLocationName?: string;
  worker?: WorkerRow;
}) {
  return renderToStaticMarkup(<WorkerForm {...props} onSaved={() => {}} />);
}

describe("positionOptionsFor", () => {
  test("no site picked keeps only positions of every site", () => {
    const options = positionOptionsFor(allPositions, null);

    expect(options.map((o) => o.id)).toEqual([POS_A1, POS_B1]);
  });

  test("a picked site keeps only its own positions", () => {
    const options = positionOptionsFor(allPositions, SITE_A);

    expect(options.map((o) => o.id)).toEqual([POS_A1]);
  });
});

describe("WorkerForm cascade", () => {
  test("create with multiple sites: Site field renders and location is locked until a site is picked", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
    });

    expect(html.includes(">Site<")).toBeTrue();
    expect(html.includes("Select a site first")).toBeTrue();
    expect(html.includes("Select a location first")).toBeTrue();
  });

  test("create with a single site: no Site select, location unlocked", () => {
    const html = renderForm({
      sites: [sites[0]!],
      siteLocations: allLocations,
      positions: allPositions,
    });

    expect(html.includes(">Site<")).toBeFalse();
    expect(html.includes("Select a site first")).toBeFalse();
    expect(html.includes("Select a location")).toBeTrue();
  });

  test("edit: the site select is pre-set to the worker's site and employee id prefilled", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: editWorker,
    });

    expect(html.includes("Site Alpha")).toBeTrue();
    expect(html.includes("Select a site first")).toBeFalse();
    expect(html.includes(`value="EMP-001"`)).toBeTrue();
    // The picked site's position picker only offers positions of that site
    // that are still active — the worker's pick shows, the deactivated one
    // and the other site's do not.
    expect(html.includes("Position Alpha One")).toBeTrue();
    expect(html.includes("Position Alpha Two")).toBeFalse();
    expect(html.includes("Position Beta One")).toBeFalse();
  });

  test("admin pinned location renders disabled with the pinned name", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      pinnedLocationName: "Loc Alpha One",
    });

    expect(html.includes("Loc Alpha One")).toBeTrue();
    expect(html.includes("disabled")).toBeTrue();
  });
});
