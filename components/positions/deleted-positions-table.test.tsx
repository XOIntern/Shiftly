import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// mock.module is process-wide in bun: spread the real module back in so
// other suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/positions",
  useSearchParams: () => new URLSearchParams("show=deleted"),
}));

const { DeletedPositionsTable } = await import("./deleted-positions-table");

import type { DeletedPositionRow } from "@/types/position";

const row = (
  overrides: Partial<DeletedPositionRow> = {},
): DeletedPositionRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Cook",
  siteName: "Nestle",
  deletedAt: "2026-02-01T10:30:00.000Z",
  ...overrides,
});

const SITES = [{ id: "22222222-2222-4222-8222-222222222222", name: "Nestle" }];

function render(
  positions: DeletedPositionRow[],
  opts: { showSiteFilter?: boolean; canPurge?: boolean } = {},
) {
  return renderToStaticMarkup(
    <DeletedPositionsTable
      positions={positions}
      sites={SITES}
      showSiteFilter={opts.showSiteFilter ?? true}
      canPurge={opts.canPurge ?? true}
      pageCount={1}
      total={positions.length}
    />,
  );
}

describe("DeletedPositionsTable", () => {
  test("a row shows the site, the position and the deletion date without the time", () => {
    const html = render([row()]);

    expect(html).toContain("Nestle");
    expect(html).toContain("Cook");
    expect(html).toContain("2026-02-01");
    expect(html).not.toContain("10:30");
  });

  test("a row offers an actions menu named after the position", () => {
    expect(render([row()])).toContain('aria-label="Actions for Cook"');
  });

  test("rows can be selected, with a select-all in the header", () => {
    const html = render([row()]);

    expect(html).toContain('aria-label="Select all rows"');
    expect(html).toContain(
      'aria-label="Select row 11111111-1111-4111-8111-111111111111"',
    );
  });

  test("the status filter and the list filter stay", () => {
    const html = render([row()]);

    expect(html).toContain('aria-label="Filter by status"');
    expect(html).toContain('aria-label="Choose position list"');
  });

  test("the site filter shows for a superadmin and is left out otherwise", () => {
    expect(render([row()], { showSiteFilter: true })).toContain(
      'aria-label="Filter by site"',
    );
    expect(render([row()], { showSiteFilter: false })).not.toContain(
      'aria-label="Filter by site"',
    );
  });

  test("an empty list says there are no deleted positions", () => {
    expect(render([])).toContain("No deleted positions.");
  });
});
