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

const { DeletedSitesTable } = await import("./deleted-sites-table");

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

  test("rows can be selected, with a select-all in the header", () => {
    const html = render([row()]);

    expect(html).toContain('aria-label="Select all rows"');
    expect(html).toContain(
      'aria-label="Select row 11111111-1111-4111-8111-111111111111"',
    );
  });

  test("both filters stay: the status filter and the list filter", () => {
    const html = render([row()]);

    expect(html).toContain('aria-label="Filter by status"');
    expect(html).toContain('aria-label="Choose site list"');
  });

  test("an empty list says there are no deleted sites", () => {
    expect(render([])).toContain("No deleted sites.");
  });
});

// A click on the confirm button cannot be driven through static markup, so the
// wiring is pinned at the source: a successful single permanent delete must
// still say so, and the error path must still toast the failure.
describe("PurgeSiteDialog wiring", () => {
  test("a successful permanent delete toasts its success message", async () => {
    const source = await Bun.file(
      new URL("./deleted-sites-table.tsx", import.meta.url),
    ).text();

    expect(source).toContain("toast.success(purgeSuccessMessage(site.name))");
  });

  test("a failed permanent delete still toasts the error", async () => {
    const source = await Bun.file(
      new URL("./deleted-sites-table.tsx", import.meta.url),
    ).text();

    expect(source).toContain("toast.error(result.message ?? GENERIC_ERROR)");
  });
});
