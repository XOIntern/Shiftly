import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as realNavigation from "next/navigation";

// The bar reads navigation hooks and imports the roster server actions; under
// bun test there is no Next request context, so both are stubbed. The real
// navigation module is spread back in because bun's module mocks are
// process-wide.
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/roster",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/app/dashboard/roster/actions", () => ({
  setAssignment: async () => ({ ok: true, data: { violations: [] } }),
  generateRoster: async () => ({ ok: true }),
  publishRoster: async () => ({ ok: true }),
  revisePlan: async () => ({ ok: true, draftPlanId: "x" }),
  suggestReplacementsAction: async () => ({ ok: true, data: [] }),
  fillDailyRequest: async () => ({ ok: true }),
}));

const { RosterStatusBar, selectedLocationFor } = await import(
  "./roster-status-bar"
);
type BarProps = Parameters<typeof RosterStatusBar>[0];

const PLAN_A = "11111111-1111-4111-8111-111111111111";
const PLAN_B = "22222222-2222-4222-9222-222222222222";
const LOC_1 = "aaaaaaaa-1111-4111-8111-111111111111";
const LOC_2 = "aaaaaaaa-2222-4222-9222-222222222222";
const SITE = "bbbbbbbb-1111-4111-8111-111111111111";

const planA = {
  id: PLAN_A,
  status: "draft" as const,
  version: 1,
  locationName: "Canteen North",
  siteName: "Nestle Pilot",
};
const planB = { ...planA, id: PLAN_B, version: 2 };

const base: BarProps = {
  week: "2026-01-05",
  gate: { action: "publish", enabled: true, reason: null },
  plans: [planA],
  selectedPlanId: PLAN_A,
  planStatus: "draft",
  planVersion: 1,
  totals: { required: 48, filled: 44 },
  violationHead: ["Worker 7 works 6 days"],
  violationCount: 2,
  isSuperadmin: false,
  sites: [],
  siteLocations: [{ id: LOC_1, name: "Canteen North", siteId: SITE }],
  pinnedLocationName: "Canteen North",
  pinnedLocationId: LOC_1,
  canWrite: true,
};

function render(overrides: Partial<BarProps> = {}): string {
  return renderToStaticMarkup(<RosterStatusBar {...base} {...overrides} />);
}

describe("RosterStatusBar", () => {
  test('draft shows "Draft v1 · 44/48 filled · 2 warnings"', () => {
    const html = render();
    expect(html).toContain("Draft v1");
    expect(html).toContain("44/48 filled");
    expect(html).toContain("2 warnings");
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "Draft v1 · 44/48 filled · 2 warnings",
    );
  });

  test("a null totals omits the filled part", () => {
    const text = render({ totals: null }).replace(/<[^>]+>/g, "");
    expect(text).toContain("Draft v1 · 2 warnings");
    expect(text).not.toContain("filled");
  });

  test("a single warning is singular and zero warnings shows no warnings text", () => {
    expect(render({ violationCount: 1 })).toContain("1 warning");
    expect(render({ violationCount: 1 })).not.toContain("1 warnings");
    expect(render({ violationCount: 0 })).not.toContain("warning");
  });

  test("the warnings text is a button that opens the violation list", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*>2 warnings<\/button>/);
  });

  test("no plan says so and shows no version", () => {
    const text = render({
      plans: [],
      selectedPlanId: null,
      planStatus: null,
      planVersion: null,
      totals: null,
      violationCount: 0,
      violationHead: [],
      gate: { action: "generate", enabled: true, reason: "7 slots from 2 requests" },
    }).replace(/<[^>]+>/g, "");
    expect(text).toContain("No plan for this week");
  });

  test("plan picker renders only when plans.length > 1", () => {
    expect(render({ plans: [planA] })).not.toContain('aria-label="Roster plan"');
    expect(render({ plans: [] })).not.toContain('aria-label="Roster plan"');
    expect(render({ plans: [planA, planB] })).toContain(
      'aria-label="Roster plan"',
    );
  });

  test("generate gate disabled renders the reason text and a link to /dashboard/requests", () => {
    const html = render({
      plans: [],
      selectedPlanId: null,
      planStatus: null,
      planVersion: null,
      totals: null,
      violationCount: 0,
      violationHead: [],
      gate: {
        action: "generate",
        enabled: false,
        reason: "No request approved by HO for this week",
      },
    });
    expect(html).toContain("No request approved by HO for this week");
    expect(html).toContain('href="/dashboard/requests"');
    const trigger = html.indexOf("Generate draft");
    expect(trigger).toBeGreaterThan(-1);
    expect(html.slice(Math.max(0, trigger - 1500), trigger)).toContain(
      'disabled=""',
    );
  });

  test("generate gate enabled shows its slot summary and an enabled button", () => {
    const html = render({
      plans: [],
      selectedPlanId: null,
      planStatus: null,
      planVersion: null,
      totals: null,
      violationCount: 0,
      violationHead: [],
      gate: { action: "generate", enabled: true, reason: "7 slots from 2 requests" },
    });
    expect(html).toContain("7 slots from 2 requests");
    expect(html).not.toContain('href="/dashboard/requests"');
    const trigger = html.indexOf("Generate draft");
    expect(html.slice(Math.max(0, trigger - 1500), trigger)).not.toContain(
      'disabled=""',
    );
  });

  test("draft with a blocking publish gate shows Publish roster disabled with its reason", () => {
    const html = render({
      gate: {
        action: "publish",
        enabled: false,
        reason: "2 rule warnings must be resolved before publishing",
      },
    });
    expect(html).toContain("Publish roster");
    expect(html).toContain("2 rule warnings must be resolved before publishing");
    const trigger = html.indexOf("Publish roster");
    expect(html.slice(Math.max(0, trigger - 1500), trigger)).toContain(
      'disabled=""',
    );
  });

  test("published renders a Revise button and Published text, no Publish button", () => {
    const html = render({
      gate: { action: "revise", enabled: true, reason: null },
      planStatus: "published",
      planVersion: 3,
      violationCount: 0,
      violationHead: [],
    });
    expect(html).toContain("Revise plan");
    expect(html).toContain("Published v3");
    expect(html).not.toContain("Publish roster");
  });

  test("ho (gate none) renders status text and no button", () => {
    const html = render({
      gate: { action: "none" },
      canWrite: false,
      planStatus: "published",
      planVersion: 1,
      violationCount: 0,
      violationHead: [],
    });
    expect(html).toContain("Published v1");
    expect(html).not.toContain("Revise plan");
    expect(html).not.toContain("Publish roster");
    expect(html).not.toContain("Generate draft");
  });

  test("an admin sees the pinned location as text, not a picker", () => {
    const html = render();
    expect(html).toContain("Canteen North");
    expect(html).not.toContain('aria-label="Location"');
  });

  test("a superadmin gets a location picker", () => {
    const html = render({
      isSuperadmin: true,
      pinnedLocationName: undefined,
      pinnedLocationId: undefined,
      sites: [{ id: SITE, name: "Nestle Pilot" }],
      siteLocations: [
        { id: LOC_1, name: "Canteen North", siteId: SITE },
        { id: LOC_2, name: "Canteen South", siteId: SITE },
      ],
    });
    expect(html).toContain('aria-label="Location"');
  });

  test("the week navigator is labelled and the previous/next buttons are named", () => {
    const html = render();
    expect(html).toContain('aria-label="Previous week"');
    expect(html).toContain('aria-label="Next week"');
    expect(html).toContain('aria-label="Week start"');
    expect(html).toContain('value="2026-01-05"');
  });
});

describe("selectedLocationFor", () => {
  const locations = [
    { id: LOC_1, name: "A", siteId: SITE },
    { id: LOC_2, name: "B", siteId: SITE },
  ];

  test("an admin's pinned location always wins", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: LOC_1,
        siteLocations: locations,
        param: LOC_2,
      }),
    ).toBe(LOC_1);
  });

  test("a picked location in scope is used", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: locations,
        param: LOC_2,
      }),
    ).toBe(LOC_2);
  });

  test("a param outside the scope is ignored", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: locations,
        param: "cccccccc-1111-4111-8111-111111111111",
      }),
    ).toBeNull();
  });

  test("a single in-scope location is selected by default", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: [locations[0]],
        param: null,
      }),
    ).toBe(LOC_1);
  });

  test("several locations and no pick selects nothing", () => {
    expect(
      selectedLocationFor({
        pinnedLocationId: undefined,
        siteLocations: locations,
        param: null,
      }),
    ).toBeNull();
  });
});
