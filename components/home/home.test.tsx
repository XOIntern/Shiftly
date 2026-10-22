import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as realNavigation from "next/navigation";

// The landing tree is plain server components; the navigation mock only
// stands in for the router context next/link reads during a static render.
// The real module is spread back in because bun's module mocks are
// process-wide (same pattern as components/nav-secondary.test.tsx).
mock.module("next/navigation", () => ({
  ...realNavigation,
}));

const { Header } = await import("./header");
const { Hero } = await import("./hero");
const Home = (await import("@/app/page")).default;

describe("Header", () => {
  const html = renderToStaticMarkup(<Header />);

  test("the only CTA is one Sign in link to the login route", () => {
    expect(html.match(/href="\/login"/g)?.length).toBe(1);
    expect(html).toContain("Sign in");
  });

  test("link count is wordmark + CTA, so there are no dead nav items", () => {
    expect(html.match(/href=/g)?.length).toBe(2);
  });

  test("shows the Shiftly logo beside the wordmark", () => {
    expect(html).toContain('alt="Shiftly logo"');
    expect(html).toContain(">Shiftly<");
  });
});

describe("Hero", () => {
  const html = renderToStaticMarkup(<Hero />);

  test("carries the brand headline once", () => {
    expect(
      html.match(/Shift scheduling for multi-site operations/g)?.length,
    ).toBe(1);
  });

  test("the card cluster carries labels, not invented statistics", () => {
    // R-17: no numbers without a real source, so visible hero text stays
    // digit-free until real data exists to replace it.
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text.match(/\d/g)).toBeNull();
  });
});

describe("Home landing page", () => {
  const html = renderToStaticMarkup(<Home />);

  test("assembles the header and the hero", () => {
    expect(html).toContain('alt="Shiftly logo"');
    expect(html).toContain("Shift scheduling for multi-site operations");
  });
});
