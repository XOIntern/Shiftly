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

const { LandingHeader } = await import("./landing-header");
const { LandingHero } = await import("./landing-hero");
const Home = (await import("@/app/page")).default;

describe("LandingHeader", () => {
  const html = renderToStaticMarkup(<LandingHeader />);

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

describe("LandingHero", () => {
  const html = renderToStaticMarkup(<LandingHero />);

  test("carries the brand headline once", () => {
    expect(html.match(/Shift scheduling for multi-site operations/g)?.length).toBe(
      1,
    );
  });

  test("the primary CTA is a Sign in link to the login route", () => {
    expect(html.match(/href="\/login"/g)?.length).toBe(1);
    expect(html).toContain("Sign in");
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
