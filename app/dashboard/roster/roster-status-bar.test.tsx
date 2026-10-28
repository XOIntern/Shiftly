import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as realNavigation from "next/navigation";

// The bar reads navigation hooks; under bun test there is no Next request
// context, so they are stubbed. The real navigation module is spread back in
// because bun's module mocks are process-wide. The server actions module is
// imported for real: rendering never calls it.
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/roster",
  useSearchParams: () => new URLSearchParams(),
}));

const { RosterStatusBar, discardDialogCopy, publishDialogCopy } = await import(
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
  sites: [],
  siteLocations: [{ id: LOC_1, name: "Canteen North", siteId: SITE }],
  selectedLocationId: LOC_1,
  navigating: false,
  canWrite: true,
  canDiscard: true,
  discardAssignmentCount: 3,
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

  test("several locations in scope get a location picker", () => {
    const html = render({
      sites: [{ id: SITE, name: "Nestle Pilot" }],
      siteLocations: [
        { id: LOC_1, name: "Canteen North", siteId: SITE },
        { id: LOC_2, name: "Canteen South", siteId: SITE },
      ],
    });
    expect(html).toContain('aria-label="Location"');
  });

  test("exactly one status live region is mounted, idle or navigating", () => {
    const idle = render();
    expect(idle.match(/role="status"/g)?.length).toBe(1);
    const busy = render({ navigating: true });
    expect(busy.match(/role="status"/g)?.length).toBe(1);
    expect(busy).toContain("Loading");
  });

  test("the status text and the reason are polite live regions", () => {
    const html = render({
      gate: {
        action: "publish",
        enabled: false,
        reason: "2 rule warnings must be resolved before publishing",
      },
    });
    const live = html.match(/aria-live="polite"[^>]*>/g) ?? [];
    expect(live.length).toBeGreaterThanOrEqual(2);
    const reasonAt = html.indexOf("2 rule warnings must be resolved");
    const before = html.slice(0, reasonAt);
    expect(before.lastIndexOf('aria-live="polite"')).toBeGreaterThan(
      before.lastIndexOf("Publish roster"),
    );
  });

  test("the week navigator is labelled and the previous/next buttons are named", () => {
    const html = render();
    expect(html).toContain('aria-label="Previous week"');
    expect(html).toContain('aria-label="Next week"');
    expect(html).toContain('aria-label="Week start"');
    expect(html).toContain('value="2026-01-05"');
  });

  test("a discardable draft offers Discard draft next to the primary button", () => {
    const html = render();
    expect(html).toContain("Discard draft");
    expect(html).toContain("Publish roster");
  });

  test("Discard draft is absent on a published plan, for an ho, and with no selected plan", () => {
    expect(
      render({
        planStatus: "published",
        gate: { action: "revise", enabled: true, reason: null },
      }),
    ).not.toContain("Discard draft");
    expect(
      render({ canDiscard: false, gate: { action: "none" } }),
    ).not.toContain("Discard draft");
    expect(render({ canDiscard: false })).not.toContain("Discard draft");
    expect(render({ selectedPlanId: null })).not.toContain("Discard draft");
  });

  test("Discard draft is absent while the plan version is unknown", () => {
    expect(render({ planVersion: null })).not.toContain("Discard draft");
  });

  test("the Discard trigger is disabled while a navigation is pending and enabled otherwise", () => {
    const trigger = (html: string) => {
      const label = html.indexOf("Discard draft");
      expect(label).toBeGreaterThan(-1);
      return html.slice(html.lastIndexOf("<button", label), label);
    };
    expect(trigger(render({ navigating: true }))).toContain('disabled=""');
    expect(trigger(render({ navigating: false }))).not.toContain('disabled=""');
  });

  test("canWrite false hides the primary button on a draft", () => {
    expect(render({ canWrite: false })).not.toContain("Publish roster");
  });
});

describe("discardDialogCopy", () => {
  test("names the draft version in the title", () => {
    expect(discardDialogCopy(2, 5).title).toBe("Discard draft v2?");
  });

  test("counts zero, one and many assignments", () => {
    expect(discardDialogCopy(1, 0).body).toBe(
      "0 assignments will be deleted. Published versions are not affected.",
    );
    expect(discardDialogCopy(1, 1).body).toBe(
      "1 assignment will be deleted. Published versions are not affected.",
    );
    expect(discardDialogCopy(1, 12).body).toBe(
      "12 assignments will be deleted. Published versions are not affected.",
    );
  });

  test("an unknown count drops the number", () => {
    expect(discardDialogCopy(3, null)).toEqual({
      title: "Discard draft v3?",
      body: "Its assignments will be deleted. Published versions are not affected.",
    });
  });
});

describe("publishDialogCopy", () => {
  const LOCKS =
    "This locks v4 and marks the week's approved requests fulfilled. Use Revise to change it afterwards.";

  test("names the version in the title", () => {
    expect(publishDialogCopy(4, null).title).toBe("Publish v4?");
  });

  test("without totals the body has no unfilled sentence", () => {
    expect(publishDialogCopy(4, null)).toEqual({
      title: "Publish v4?",
      body: LOCKS,
    });
  });

  test("balanced demand has no unfilled sentence", () => {
    expect(publishDialogCopy(4, { required: 6, filled: 6 }).body).toBe(LOCKS);
  });

  test("short by one says 1 slot is still unfilled", () => {
    expect(publishDialogCopy(4, { required: 6, filled: 5 }).body).toBe(
      `${LOCKS} 1 slot is still unfilled.`,
    );
  });

  test("short by many counts the slots", () => {
    expect(publishDialogCopy(4, { required: 10, filled: 3 }).body).toBe(
      `${LOCKS} 7 slots are still unfilled.`,
    );
  });
});
