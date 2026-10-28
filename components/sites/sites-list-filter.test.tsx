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

const { SitesListFilter, nextListParams } = await import("./sites-list-filter");

describe("nextListParams", () => {
  const current = () =>
    new URLSearchParams("q=foo&status=active&sort=name%3Adesc&page=3");

  test("choosing the deleted list sets show and restarts at page 1", () => {
    const next = nextListParams(current(), "deleted");

    expect(next.get("show")).toBe("deleted");
    expect(next.get("page")).toBe("1");
  });

  test("a switch keeps the search term but drops status and sort", () => {
    const next = nextListParams(current(), "deleted");

    expect(next.get("q")).toBe("foo");
    expect(next.has("status")).toBe(false);
    expect(next.has("sort")).toBe(false);
  });

  test("choosing the active list removes show", () => {
    const params = current();
    params.set("show", "deleted");

    const next = nextListParams(params, "active");

    expect(next.has("show")).toBe(false);
    expect(next.get("q")).toBe("foo");
  });

  test("an unknown value is the active list", () => {
    const params = current();
    params.set("show", "deleted");

    expect(nextListParams(params, "bogus").has("show")).toBe(false);
    expect(nextListParams(params, null).has("show")).toBe(false);
  });

  test("does not mutate the params it was given", () => {
    const params = current();

    nextListParams(params, "deleted");

    expect(params.has("show")).toBe(false);
    expect(params.get("status")).toBe("active");
  });
});

describe("SitesListFilter", () => {
  test("renders a trigger of its own, separate from the status filter", () => {
    const html = renderToStaticMarkup(<SitesListFilter />);

    expect(html).toContain('aria-label="Choose site list"');
    expect(html).not.toContain("Filter by status");
  });
});
