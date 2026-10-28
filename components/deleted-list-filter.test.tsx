import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The URL the filter reads, switched per test. mock.module is process-wide in
// bun: spread the real module back in so other suites that import
// next/navigation keep its other exports.
let search = "show=deleted";
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/sites",
  useSearchParams: () => new URLSearchParams(search),
}));

const { DeletedListFilter } = await import("./deleted-list-filter");

describe("DeletedListFilter", () => {
  test("renders a trigger of its own, separate from the status filter", () => {
    const html = renderToStaticMarkup(<DeletedListFilter singular="site" />);

    expect(html).toContain('aria-label="Choose site list"');
    expect(html).not.toContain("Filter by status");
  });

  test("names the control after the entity it lists, for assistive tech", () => {
    const html = renderToStaticMarkup(
      <DeletedListFilter singular="work area" />,
    );

    expect(html).toContain('aria-label="Choose work area list"');
  });

  test("the deleted list reads as plain Deleted, with no entity name", () => {
    search = "show=deleted";

    const html = renderToStaticMarkup(
      <DeletedListFilter singular="work area" />,
    );

    expect(html).toContain(">Deleted<");
    expect(html).not.toContain("Deleted work");
  });

  test("the list that is not deleted reads as plain Current, never Active, which belongs to the status filter", () => {
    search = "";

    const html = renderToStaticMarkup(<DeletedListFilter singular="site" />);

    expect(html).toContain(">Current<");
    expect(html).not.toContain("Active");
    expect(html).not.toContain("Current site");
  });
});
