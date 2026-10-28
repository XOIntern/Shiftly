import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SitesViewTabs } from "./sites-view-tabs";

// The anchor tag that carries a given label, so a test can assert on its own
// href and aria-current without matching the sibling tab.
function anchorFor(html: string, label: string): string {
  const match = [...html.matchAll(/<a\b[^>]*>.*?<\/a>/g)].find((m) =>
    m[0].includes(`>${label}<`),
  );
  if (!match) throw new Error(`no tab labelled ${label} in ${html}`);
  return match[0];
}

describe("SitesViewTabs", () => {
  test("the active view marks only Active as current", () => {
    const html = renderToStaticMarkup(<SitesViewTabs view="active" q="" />);

    expect(anchorFor(html, "Active")).toContain('aria-current="page"');
    expect(anchorFor(html, "Deleted")).not.toContain("aria-current");
  });

  test("the deleted view marks only Deleted as current", () => {
    const html = renderToStaticMarkup(<SitesViewTabs view="deleted" q="" />);

    expect(anchorFor(html, "Deleted")).toContain('aria-current="page"');
    expect(anchorFor(html, "Active")).not.toContain("aria-current");
  });

  test("without a search the links carry no q", () => {
    const html = renderToStaticMarkup(<SitesViewTabs view="active" q="" />);

    expect(anchorFor(html, "Active")).toContain('href="/dashboard/sites"');
    expect(anchorFor(html, "Deleted")).toContain(
      'href="/dashboard/sites?view=deleted"',
    );
  });

  test("a search term is URL-encoded into both links", () => {
    const html = renderToStaticMarkup(
      <SitesViewTabs view="active" q="foo bar&x" />,
    );

    expect(anchorFor(html, "Active")).toContain(
      'href="/dashboard/sites?q=foo+bar%26x"',
    );
    expect(anchorFor(html, "Deleted")).toContain(
      'href="/dashboard/sites?view=deleted&amp;q=foo+bar%26x"',
    );
  });
});
