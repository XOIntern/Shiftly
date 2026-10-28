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
