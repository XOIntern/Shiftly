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

const { SitesListFilter } = await import("./sites-list-filter");

describe("SitesListFilter", () => {
  test("renders a trigger of its own, separate from the status filter", () => {
    const html = renderToStaticMarkup(<SitesListFilter />);

    expect(html).toContain('aria-label="Choose site list"');
    expect(html).not.toContain("Filter by status");
  });
});
