import { describe, expect, test } from "bun:test";

import { finalFocusTarget } from "@/lib/final-focus";

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
