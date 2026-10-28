import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// mock.module is process-wide in bun: spread the real module back in so
// other suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/requests",
  useSearchParams: () => new URLSearchParams(),
}));

const { RequestsTable } =
  await import("@/app/dashboard/requests/requests-table");

import type { MpRequestRow } from "@/types/mp-request";

const row = (overrides: Partial<MpRequestRow>): MpRequestRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "weekly",
  status: "open",
  weekStart: "2026-01-05",
  requestDate: null,
  siteLocationId: "22222222-2222-4222-8222-222222222222",
  siteName: "Nestle",
  locationName: "Cikarang",
  lines: [],
  updatedAt: "2026-01-02T08:00:00.000Z",
  ...overrides,
});

function renderRows(requests: MpRequestRow[]) {
  return renderToStaticMarkup(
    <RequestsTable
      requests={requests}
      canWrite
      canApprove
      showSite
      showLocation
      pageCount={1}
      total={requests.length}
      filtered={false}
    />,
  );
}

function renderEmpty(filtered: boolean) {
  return renderToStaticMarkup(
    <RequestsTable
      requests={[]}
      canWrite
      canApprove
      showSite
      showLocation
      pageCount={1}
      total={0}
      filtered={filtered}
    />,
  );
}

describe("RequestsTable empty state", () => {
  test("no rows and no filters says there are no requests yet", () => {
    const html = renderEmpty(false);

    expect(html.includes("No requests yet")).toBeTrue();
    expect(html.includes("Clear filters")).toBeFalse();
  });

  test("no rows under a filter says nothing matches and links to the unfiltered list", () => {
    const html = renderEmpty(true);

    expect(html.includes("No requests match these filters.")).toBeTrue();
    expect(html).toMatch(
      /<a [^>]*href="\/dashboard\/requests"[^>]*>Clear filters<\/a>/,
    );
    expect(html.includes("No requests yet")).toBeFalse();
  });
});

describe("RequestsTable accessible names", () => {
  const first = row({ id: "11111111-1111-4111-8111-111111111111" });
  const second = row({
    id: "33333333-3333-4333-8333-333333333333",
    weekStart: "2026-01-12",
  });
  const daily = row({
    id: "44444444-4444-4444-8444-444444444444",
    type: "daily",
    weekStart: null,
    requestDate: "2026-01-08",
  });

  test("two requests of one location get different row-menu names, each ending with its period", () => {
    const html = renderRows([first, second, daily]);

    expect(
      html.includes(
        'aria-label="Actions for request Nestle Cikarang, week of 2026-01-05"',
      ),
    ).toBeTrue();
    expect(
      html.includes(
        'aria-label="Actions for request Nestle Cikarang, week of 2026-01-12"',
      ),
    ).toBeTrue();
    expect(
      html.includes(
        'aria-label="Actions for request Nestle Cikarang, date 2026-01-08"',
      ),
    ).toBeTrue();
  });

  test("Approve and Reject names carry site, location and period", () => {
    const html = renderRows([first]);

    expect(
      html.includes(
        'aria-label="Approve request Nestle Cikarang, week of 2026-01-05"',
      ),
    ).toBeTrue();
    expect(
      html.includes(
        'aria-label="Reject request Nestle Cikarang, week of 2026-01-05"',
      ),
    ).toBeTrue();
  });

  test("a missing site name leaves no double space", () => {
    const html = renderRows([row({ siteName: "" })]);

    expect(
      html.includes(
        'aria-label="Actions for request Cikarang, week of 2026-01-05"',
      ),
    ).toBeTrue();
    expect(html.includes("request  ")).toBeFalse();
  });

  test("inline Approve and Reject reach 44px on phones, desktop size unchanged", () => {
    const html = renderRows([first]);
    const buttonOf = (label: string) =>
      new RegExp(`<button[^>]*aria-label="${label}[^"]*"[^>]*>`).exec(html)![0];

    for (const label of ["Approve request", "Reject request"]) {
      const tag = buttonOf(label);
      expect(tag.includes("max-sm:h-11")).toBeTrue();
      expect(tag.includes("h-7")).toBeTrue();
    }
  });

  test("the arrow of View in roster is hidden from assistive tech", () => {
    const html = renderRows([row({ status: "approved" })]);

    expect(html).toMatch(/View in roster <span aria-hidden="true">→<\/span>/);
    expect(html.includes("View in roster →")).toBeFalse();
  });
});
