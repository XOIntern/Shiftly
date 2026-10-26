import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/types/session";
import * as realNavigation from "next/navigation";

// The landing tree is plain server components; the navigation mock only
// stands in for the router context next/link reads during a static render.
// The real module is spread back in because bun's module mocks are
// process-wide (same pattern as components/nav-secondary.test.tsx).
mock.module("next/navigation", () => ({
  ...realNavigation,
}));

// The header is auth-aware and reads the session itself, so the whole
// module is stubbed behind a mutable signed-in actor — null renders the
// signed-out header, an object the Dashboard CTA. Every export other
// suites may resolve must exist here (same pattern as
// app/dashboard/page.test.ts).
let actor: SessionUser | null = null;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// The header is an async server component; awaiting it resolves its own
// boundary, leaving a synchronous tree renderToStaticMarkup can render
// without a DOM (same trick as app/dashboard/page.test.ts).
async function renderHeader(): Promise<string> {
  const { Header } = await import("./header");
  return renderToStaticMarkup(await Header());
}

const { Hero } = await import("./hero");
const Home = (await import("@/app/page")).default;

describe("Header, signed out", () => {
  test("the only CTA is one Sign in link to the login route", async () => {
    const markup = await renderHeader();
    expect(markup.match(/href="\/login"/g)?.length).toBe(1);
    expect(markup).toContain("Sign in");
  });

  test("link count is wordmark + CTA, so there are no dead nav items", async () => {
    const markup = await renderHeader();
    expect(markup.match(/href=/g)?.length).toBe(2);
  });

  test("shows the Shiftly logo beside the wordmark", async () => {
    const markup = await renderHeader();
    expect(markup).toContain('alt="Shiftly logo"');
    expect(markup).toContain(">Shiftly<");
  });
});

describe("Header, Notion-style bar", () => {
  test("is a flat full-width bar, not a floating glass pill", async () => {
    const markup = await renderHeader();
    expect(markup).not.toContain("data-glass");
    expect(markup).not.toContain("backdrop-blur");
    expect(markup).not.toContain("rounded-2xl");
  });
});

describe("Header, signed in", () => {
  test("the CTA becomes Dashboard — no Sign in offer to a signed-in user", async () => {
    actor = {
      id: "landing-hdr-sa",
      name: "Landing Super",
      email: "landing-header@shiftly.test",
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const markup = await renderHeader();
    expect(markup.match(/href="\/dashboard"/g)?.length).toBe(1);
    expect(markup).toContain("Dashboard");
    expect(markup).not.toContain("Sign in");
    actor = null;
  });
});

describe("Hero", () => {
  const html = renderToStaticMarkup(<Hero />);

  test("carries the brand headline once", () => {
    expect(
      html.match(/Shift scheduling for multi-site operations/g)?.length,
    ).toBe(1);
  });

  test("surfaces are flat: no glass, blur, or dark anchor card", () => {
    expect(html).not.toContain("data-glass");
    expect(html).not.toContain("backdrop-blur");
    expect(html).not.toContain("bg-primary-900");
  });

  test("shows four outsourced job illustrations, each captioned", () => {
    for (const name of ["Cleaning", "Catering", "Security", "Production"]) {
      expect(html).toContain(`<figcaption`);
      expect(html).toContain(`>${name}<`);
    }
    expect(html.match(/<figure/g)?.length).toBe(4);
    expect(html.match(/<svg/g)?.length).toBe(4);
  });

  test("the illustrations are decorative and drawn from design tokens", () => {
    const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
    expect(svgs.length).toBe(4);
    for (const svg of svgs) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('viewBox="');
      // Token classes only: no raw hex fill or stroke.
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  test("the old roster-cell figures are gone", () => {
    expect(html).not.toContain("grid-cols-7");
    expect(html).not.toContain("Weekly roster");
    expect(html).not.toContain("Work rules");
  });

  test("has no sign-up form or hero CTA: sign in lives only in the nav", () => {
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("href=");
  });

  test("has no category pill above the headline", () => {
    expect(html).not.toContain("rounded-full");
  });

  test("the card cluster carries labels, not invented statistics", () => {
    // R-17: no numbers without a real source, so visible hero text stays
    // digit-free until real data exists to replace it.
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text.match(/\d/g)).toBeNull();
  });
});

describe("Home landing page", () => {
  // The header streams inside Suspense, so a static render shows the
  // fallback pill — its logo slot is what this assertion pins.
  const html = renderToStaticMarkup(<Home />);

  test("assembles the header and the hero", () => {
    expect(html).toContain('alt="Shiftly logo"');
    expect(html).toContain("Shift scheduling for multi-site operations");
  });

  test("the page is flat: no gradient backdrop, no drifting blobs", () => {
    expect(html).not.toContain("gradient-hero");
    expect(html).not.toContain("animate-blob-drift");
    expect(html).not.toContain("data-glass");
  });
});
