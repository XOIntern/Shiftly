import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// mock.module is process-wide in bun: spread the real module back in so
// other suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/sites",
  useSearchParams: () => new URLSearchParams("show=deleted"),
}));

const { DeletedSitesTable, purgeDescription } =
  await import("./deleted-sites-table");

import type { DeletedSiteRow } from "@/types/site";

const row = (overrides: Partial<DeletedSiteRow> = {}): DeletedSiteRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Nestle Cikarang",
  deletedAt: "2026-02-01T10:30:00.000Z",
  ...overrides,
});

function render(sites: DeletedSiteRow[]) {
  return renderToStaticMarkup(
    <DeletedSitesTable sites={sites} pageCount={1} total={sites.length} />,
  );
}

describe("DeletedSitesTable", () => {
  test("a row shows the site name and its deletion date without the time", () => {
    const html = render([row()]);

    expect(html).toContain("Nestle Cikarang");
    expect(html).toContain("2026-02-01");
    expect(html).not.toContain("10:30");
  });

  test("a row offers an actions menu named after the site", () => {
    expect(render([row()])).toContain('aria-label="Actions for Nestle Cikarang"');
  });

  test("there is no selection column", () => {
    expect(render([row()])).not.toContain('type="checkbox"');
  });

  test("the list filter stays so the list can be switched back, the status filter goes", () => {
    const html = render([row()]);

    expect(html).toContain('aria-label="Choose site list"');
    expect(html).not.toContain("Filter by status");
  });

  test("an empty list says there are no deleted sites", () => {
    expect(render([])).toContain("No deleted sites.");
  });
});

describe("purgeDescription", () => {
  test("names the site and warns that it cannot be undone", () => {
    const text = purgeDescription("Nestle Cikarang");

    expect(text).toContain("Nestle Cikarang");
    expect(text).toContain("cannot be undone");
  });

  test("lists what goes with the site and what blocks the delete", () => {
    const text = purgeDescription("X");

    for (const part of [
      "locations",
      "work areas",
      "positions",
      "shifts",
      "workers",
      "users",
    ]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("roster, request or audit history");
  });
});
