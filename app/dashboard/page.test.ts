import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { SessionUser } from "@/types/session";

// The dashboard home reads its actor through requireUser and its counts
// through lib/dashboard-counts — both swapped for stubs so the server
// component renders without a database. The mock swaps the WHOLE module
// across bun's single test process, so every export other suites may
// resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// Task 2's counts module is mocked, not run against the DB — the counts
// themselves are pinned by lib/dashboard-counts.test.ts.
mock.module("@/lib/dashboard-counts", () => ({
  dashboardCounts: async () => ({
    workers: 12,
    positions: 8,
    workAreas: 5,
    locations: 3,
  }),
}));

// Other suites resolve these navigations; nothing here needs them.
mock.module("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  // Pages under test may call notFound(); every stub in the repo carries it
  // because bun's module mocks are process-wide and the last registration
  // wins across suites.
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

// The page is an async server component; awaiting it resolves its own
// boundary, leaving a synchronous SectionCards tree renderToStaticMarkup
// can render without a DOM.
async function renderDashboard(): Promise<string> {
  const { default: DashboardPage } = await import("./page");
  const tree = await DashboardPage();
  return renderToStaticMarkup(tree);
}

describe("dashboard home (issue #123)", () => {
  test("renders the real counts with no placeholder content", async () => {
    actor = {
      id: "t3-dash-sa",
      name: "Dashboard Super",
      email: "t3-dash-super@shiftly.test",
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const html = await renderDashboard();

    // Real numbers and labels — counts from the mocked module.
    expect(html.includes("12")).toBeTrue();
    expect(html.includes("Active workers")).toBeTrue();

    // None of the old placeholder markup survives.
    expect(html.includes("Placeholder")).toBeFalse();
    expect(html.includes("96.2%")).toBeFalse();
    expect(html.includes("128")).toBeFalse();
    expect(html.includes("Recent rosters")).toBeFalse();
  });

  test("an admin sees three cards — Active locations is absent", async () => {
    actor = {
      id: "t3-dash-admin",
      name: "Dashboard Admin",
      email: "t3-dash-admin@shiftly.test",
      role: "admin",
      siteId: null,
      siteLocationId: "t3-dash-loc",
      isActive: true,
    };
    const html = await renderDashboard();

    expect(html.includes("Active locations")).toBeFalse();
    expect(html.includes("Active workers")).toBeTrue();
    expect(html.includes("Positions")).toBeTrue();
    expect(html.includes("Work areas")).toBeTrue();
  });
});
