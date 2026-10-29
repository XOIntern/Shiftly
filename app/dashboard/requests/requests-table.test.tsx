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
  status: "approved",
  weekStart: "2026-01-05",
  requestDate: null,
  siteLocationId: "22222222-2222-4222-8222-222222222222",
  siteName: "Nestle",
  locationName: "Cikarang",
  lines: [],
  updatedAt: "2026-01-02T08:00:00.000Z",
  rosterLocked: false,
  ...overrides,
});

function renderRows(requests: MpRequestRow[]) {
  return renderToStaticMarkup(
    <RequestsTable
      requests={requests}
      canWrite
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

  test("no row offers Approve or Reject, whatever its status", () => {
    const html = renderRows(
      (["open", "approved", "fulfilled", "rejected", "withdrawn"] as const).map(
        (status, index) =>
          row({
            id: `55555555-5555-4555-8555-55555555555${index}`,
            status,
            weekStart: `2026-02-0${index + 2}`,
          }),
      ),
    );

    // The Approved / Rejected badges still render; only the buttons are gone.
    expect(html.includes("Approve request")).toBeFalse();
    expect(html.includes("Reject request")).toBeFalse();
    expect(html.includes(">Approve<")).toBeFalse();
    expect(html.includes(">Reject<")).toBeFalse();
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

  test("the arrow of View in roster is hidden from assistive tech", () => {
    const html = renderRows([row({ status: "approved" })]);

    expect(html).toMatch(/View in roster <span aria-hidden="true">→<\/span>/);
    expect(html.includes("View in roster →")).toBeFalse();
  });
});
