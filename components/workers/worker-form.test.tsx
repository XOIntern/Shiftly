import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { PositionRow } from "@/types/position";
import type { SiteOption, SiteLocationOption } from "@/types/site";
import type { WorkerRow } from "@/types/worker";
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

// The field label must point at the chips input and the chips input must be
// the combobox — a bare substring check would pass even if both attributes
// moved onto unrelated elements.
function inputTagById(html: string, id: string) {
  const inputTags = html.match(/<input\b[^>]*/g) ?? [];
  return inputTags.find((candidate) => candidate.includes(`id="${id}"`));
}

function expectPositionFieldLabelled(html: string) {
  expect(html).toMatch(
    /<label[^>]*for="worker-positions"[^>]*>Positions<\/label>/,
  );
  expect(html).toMatch(/<input[^>]*role="combobox"[^>]*id="worker-positions"/);
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
    // This is the positionSiteId === null branch: the field must still be
    // named while the combobox shows its "select a location" placeholder.
    expectPositionFieldLabelled(html);
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

  test("the Employee ID input carries the required attribute", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
    });

    const tag = inputTagById(html, "worker-employee-id");
    expect(tag).toBeDefined();
    expect(tag).toMatch(/\brequired(?:="")?(?=[\s/>])/);
  });

  test("the Name input carries the required attribute", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
    });

    const tag = inputTagById(html, "worker-name");
    expect(tag).toBeDefined();
    expect(tag).toMatch(/\brequired(?:="")?(?=[\s/>])/);
  });

  test("the Contract end input carries the required attribute", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
    });

    const tag = inputTagById(html, "worker-contract-end");
    expect(tag).toBeDefined();
    expect(tag).toMatch(/\brequired(?:="")?(?=[\s/>])/);
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

describe("WorkerForm position picker", () => {
  test("an edit with two attached positions renders a chip for each", () => {
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

    expect((html.match(/data-slot="combobox-chip"/g) ?? []).length).toBe(2);
    expect(html.includes("Position Alpha One")).toBeTrue();
    expect(html.includes("Position Alpha Two")).toBeTrue();
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

  test("the field label points at the combobox input and each chip is named", () => {
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

    expectPositionFieldLabelled(html);
    // The chip remove button is icon-only, so the chip has to name both the
    // selection and the removal for assistive tech.
    expect(html.includes('aria-label="Position Alpha One"')).toBeTrue();
    expect(html.includes('aria-label="Remove Position Alpha One"')).toBeTrue();
    expect(html.includes('aria-label="Position Alpha Two (inactive)"')).toBeTrue();
  });

  test("the picker stays enabled while the site still has positions", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: allPositions,
      worker: editWorker,
    });

    expect(html).not.toMatch(/<input[^>]*disabled[^>]*id="worker-positions"/);
    expect(html.includes('placeholder="Select positions"')).toBeTrue();
  });

  test("the picker is disabled with a placeholder when the site has no positions", () => {
    const html = renderForm({
      sites,
      siteLocations: allLocations,
      positions: [],
      worker: editWorker,
    });

    expectPositionFieldLabelled(html);
    expect(html).toMatch(/<input[^>]*disabled[^>]*id="worker-positions"/);
    expect(html.includes('placeholder="No positions for this site yet"')).toBeTrue();
  });
});
