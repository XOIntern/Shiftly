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

const { DeletedListFilter } = await import("./deleted-list-filter");

describe("DeletedListFilter", () => {
  test("renders a trigger of its own, separate from the status filter", () => {
    const html = renderToStaticMarkup(
      <DeletedListFilter singular="site" plural="sites" />,
    );

    expect(html).toContain('aria-label="Choose site list"');
    expect(html).not.toContain("Filter by status");
  });

  test("labels the trigger with the entity it lists", () => {
    const html = renderToStaticMarkup(
      <DeletedListFilter singular="location" plural="locations" />,
    );

    expect(html).toContain('aria-label="Choose location list"');
  });
});
