import { afterEach, describe, expect, test } from "bun:test";

import {
  FOCUS_FALLBACK_SELECTOR,
  finalFocusTarget,
  focusFallbackTarget,
} from "@/lib/final-focus";

// Bun runs without a DOM; a plain object stands in for the element, the
// helper only passes it through.
const heading = { id: "page-title" } as unknown as HTMLElement;

describe("finalFocusTarget", () => {
  test("a successful action with a fallback element focuses the fallback", () => {
    expect(finalFocusTarget(true, heading)).toBe(heading);
  });

  test("a successful action without a fallback element keeps the default return to the trigger", () => {
    expect(finalFocusTarget(true, null)).toBe(true);
  });

  test("a cancelled or failed action returns focus to the trigger even when a fallback exists", () => {
    expect(finalFocusTarget(false, heading)).toBe(true);
  });

  test("a cancelled or failed action without a fallback returns focus to the trigger", () => {
    expect(finalFocusTarget(false, null)).toBe(true);
  });
});

describe("focusFallbackTarget", () => {
  const globals = globalThis as { document?: unknown };
  const originalDocument = globals.document;

  afterEach(() => {
    globals.document = originalDocument;
  });

  // A minimal stand-in for the document: it answers only the one selector.
  const fakeDocument = (element: HTMLElement | null) => {
    const selectors: string[] = [];
    globals.document = {
      querySelector: (selector: string) => {
        selectors.push(selector);
        return element;
      },
    };
    return selectors;
  };

  test("a successful action focuses the fallback element", () => {
    fakeDocument(heading);
    expect(focusFallbackTarget(true)).toBe(heading);
  });

  test("a cancelled or failed action returns focus to the trigger", () => {
    fakeDocument(heading);
    expect(focusFallbackTarget(false)).toBe(true);
  });

  test("looks the fallback up by the shared selector", () => {
    const selectors = fakeDocument(heading);
    focusFallbackTarget(true);
    expect(selectors).toEqual([FOCUS_FALLBACK_SELECTOR]);
  });

  test("returns true after a success when the page has no fallback element", () => {
    fakeDocument(null);
    expect(focusFallbackTarget(true)).toBe(true);
  });
});
