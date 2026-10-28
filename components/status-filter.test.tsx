import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// mock.module is process-wide in bun: spread the real module back in so
// other suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/sites",
  useSearchParams: () => new URLSearchParams("status=deleted"),
}));

const { StatusFilter, nextStatusParams, statusFilterValue } =
  await import("./status-filter");

const DELETED = [{ value: "deleted", label: "Deleted" }];

describe("statusFilterValue", () => {
  test("the built-in statuses select themselves", () => {
    expect(statusFilterValue("active", [])).toBe("active");
    expect(statusFilterValue("inactive", [])).toBe("inactive");
  });

  test("no param and junk both read as all statuses", () => {
    expect(statusFilterValue(null, [])).toBe("all");
    expect(statusFilterValue("junk", DELETED)).toBe("all");
  });

  test("an extra option is selectable only when the page offers it", () => {
    expect(statusFilterValue("deleted", DELETED)).toBe("deleted");
    expect(statusFilterValue("deleted", [])).toBe("all");
  });
});

describe("nextStatusParams", () => {
  const current = () => new URLSearchParams("q=foo&sort=name%3Adesc&page=3");

  test("choosing a status sets it and restarts at page 1, keeping q and sort", () => {
    const next = nextStatusParams(current(), "inactive", []);

    expect(next.get("status")).toBe("inactive");
    expect(next.get("page")).toBe("1");
    expect(next.get("q")).toBe("foo");
    expect(next.get("sort")).toBe("name:desc");
  });

  test("all statuses removes the param", () => {
    const params = current();
    params.set("status", "active");

    const next = nextStatusParams(params, "all", []);

    expect(next.has("status")).toBe(false);
    expect(next.get("page")).toBe("1");
  });

  test("an offered extra option is written to the URL", () => {
    expect(nextStatusParams(current(), "deleted", DELETED).get("status")).toBe(
      "deleted",
    );
  });

  test("an extra option the page does not offer is dropped", () => {
    const params = current();
    params.set("status", "active");

    expect(nextStatusParams(params, "deleted", []).has("status")).toBe(false);
  });

  test("does not mutate the params it was given", () => {
    const params = current();

    nextStatusParams(params, "active", []);

    expect(params.has("status")).toBe(false);
  });
});

describe("StatusFilter", () => {
  test("renders the status trigger with and without extra options", () => {
    for (const extraOptions of [undefined, DELETED]) {
      const html = renderToStaticMarkup(
        <StatusFilter extraOptions={extraOptions} />,
      );
      expect(html).toContain('aria-label="Filter by status"');
    }
  });
});
