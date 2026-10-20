import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  PositionRow,
  SiteOption,
  SiteLocationOption,
  WorkerRow,
} from "@/types/forms";
import {
  WorkerForm,
  positionOptionsFor,
  visiblePositionOptions,
} from "./worker-form";

// Form fixtures: site A holds locations LA1/LA2 and positions PA1/PA2 (PA2
// inactive), site B holds LB and PB. No DB — the dialog composes everything
// from the option props it receives; the page pre-filters, the form filters
// isActive defensively inside positionOptionsFor.
const SITE_A = "11111111-1111-1111-1111-111111111111";
const SITE_B = "22222222-2222-2222-2222-222222222222";
const LOC_A1 = "aaaaaaaa-1111-1111-1111-111111111111";
const LOC_A2 = "aaaaaaaa-2222-2222-2222-222222222222";
const LOC_B1 = "bbbbbbbb-1111-1111-1111-111111111111";
const POS_A1 = "33333333-3333-3333-3333-333333333333";
const POS_A2 = "44444444-4444-4444-4444-444444444444";
const POS_B1 = "55555555-5555-5555-5555-555555555555";

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
  siteId: SITE_A,
  siteName: "Site Alpha",
  locationName: "Loc Alpha One",
  positions: [{ id: POS_A1, name: "Position Alpha One", isActive: true }],
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

// The group label and its aria-labelledby must be on a <label> and the
// role="group" element respectively — a bare substring check would pass
// even if both attributes moved onto unrelated elements.
function expectPositionGroupLabelled(html: string) {
  expect(html).toMatch(
    /<div role="group"[^>]*aria-labelledby="worker-positions-label"/,
  );
  expect(html).toMatch(
    /<label[^>]*id="worker-positions-label"[^>]*>Positions<\/label>/,
  );
}

describe("worker-form fixtures", () => {
  test("position fixtures do not collide with site or location ids", () => {
    const nonPositionIds = [SITE_A, SITE_B, LOC_A1, LOC_A2, LOC_B1];

    for (const id of [POS_A1, POS_A2, POS_B1]) {
      expect(nonPositionIds).not.toContain(id);
    }
    expect(new Set([POS_A1, POS_A2, POS_B1]).size).toBe(3);
  });
});

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
    // This is the positionSiteId === null branch: the group must still be
    // named while the picker shows its "select a location" placeholder.
    expectPositionGroupLabelled(html);
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

describe("visiblePositionOptions", () => {
  test("unions the site's active candidates with an attached inactive row", () => {
    const options = visiblePositionOptions(allPositions, SITE_A, [POS_A2]);

    // POS_A1 is a normal candidate; POS_A2 is inactive and only visible
    // because it is already attached.
    expect(options.map((o) => o.id)).toEqual([POS_A1, POS_A2]);
  });

  test("never unions a selected id from another site", () => {
    const options = visiblePositionOptions(allPositions, SITE_A, [POS_B1]);

    expect(options.map((o) => o.id)).toEqual([POS_A1]);
  });
});

describe("WorkerForm position checkboxes", () => {
  test("an edit with two attached positions renders both checked", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: {
        ...editWorker,
        positions: [
          { id: POS_A1, name: "Position Alpha One", isActive: true },
          { id: POS_A2, name: "Position Alpha Two", isActive: true },
        ],
      },
    });

    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(2);
  });

  test("an attached inactive position renders with (inactive)", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: {
        ...editWorker,
        positions: [
          { id: POS_A2, name: "Position Alpha Two", isActive: false },
        ],
      },
    });

    expect(html.includes("Position Alpha Two (inactive)")).toBeTrue();
  });

  test("an inactive position that is not attached is not rendered", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: editWorker,
    });

    expect(html.includes("Position Alpha Two")).toBeFalse();
  });

  test("each checkbox carries its position id and the group is named", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: {
        ...editWorker,
        positions: [
          { id: POS_A1, name: "Position Alpha One", isActive: true },
          { id: POS_A2, name: "Position Alpha Two", isActive: false },
        ],
      },
    });

    expect(html.includes(`id="position-${POS_A1}"`)).toBeTrue();
    expect(html.includes(`id="position-${POS_A2}"`)).toBeTrue();
    expectPositionGroupLabelled(html);
  });

  test("the group keeps its label when the site has no positions", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: [],
      worker: editWorker,
    });

    expectPositionGroupLabelled(html);
    expect(html.includes("No positions for this site yet")).toBeTrue();
  });

  test("each checkbox is named by its position name for assistive tech", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: {
        ...editWorker,
        positions: [
          { id: POS_A1, name: "Position Alpha One", isActive: true },
          { id: POS_A2, name: "Position Alpha Two", isActive: false },
        ],
      },
    });

    // Base UI puts role="checkbox" on a span and hides the input; the span
    // carries no name unless we give it one, and a wrapping <label> cannot
    // name a span.
    expect(html.includes('aria-label="Position Alpha One"')).toBeTrue();
    expect(html.includes('aria-label="Position Alpha Two"')).toBeTrue();
  });
});
