import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import DashboardLoading from "./loading";

// The shell mirrors the home page: a title, four count cards, then two
// columns of widget cards. The table skeleton it replaced has no place here.
describe("dashboard loading shell", () => {
  test("announces itself as a busy status region", () => {
    const html = renderToStaticMarkup(<DashboardLoading />);
    expect(html.includes('role="status"')).toBeTrue();
    expect(html.includes('aria-busy="true"')).toBeTrue();
    expect(html.includes('aria-label="Loading dashboard"')).toBeTrue();
  });

  test("draws four count cards and the two widget columns", () => {
    const html = renderToStaticMarkup(<DashboardLoading />);
    expect(html.match(/data-slot="card"/g)).toHaveLength(4 + 4);
  });

  test("keeps no table-shaped rows", () => {
    const html = renderToStaticMarkup(<DashboardLoading />);
    expect(html.includes("h-10 w-full")).toBeFalse();
  });
});
