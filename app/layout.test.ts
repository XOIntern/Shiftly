import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The root layout pulls in next/font, which does not load under bun test, so
// the contract is pinned against the source text (same approach as
// globals.test.ts for the stylesheet).
const layout = readFileSync(join(import.meta.dir, "layout.tsx"), "utf8");
const css = readFileSync(join(import.meta.dir, "globals.css"), "utf8");

describe("smooth scrolling", () => {
  // Next 16 no longer overrides `scroll-behavior` on route changes, so a page
  // that scrolls smoothly glides back to the top on every navigation. The
  // data attribute hands that back to Next: instant during a transition,
  // smooth otherwise.
  test("the stylesheet scrolls smoothly, so <html> must opt in to Next's route-transition handling", () => {
    expect(/scroll-smooth|scroll-behavior:\s*smooth/.test(css)).toBe(true);

    const htmlTag = layout.match(/<html\b[^>]*>/)?.[0] ?? "";
    expect(htmlTag.includes('data-scroll-behavior="smooth"')).toBe(true);
  });
});
