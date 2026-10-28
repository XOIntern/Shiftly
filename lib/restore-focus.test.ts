import { describe, expect, test } from "bun:test";

import { restoreFocusTarget, shouldRestoreFocus } from "@/lib/restore-focus";

describe("shouldRestoreFocus", () => {
  test("once the action settles with focus dropped to <body> and the opener still on the page, focus is restored", () => {
    expect(shouldRestoreFocus(true, true, false)).toBe(true);
  });

  test("while the action is still pending nothing moves: the opener is still disabled", () => {
    expect(shouldRestoreFocus(true, true, true)).toBe(false);
  });

  test("focus that already landed somewhere (the opener, the page title, a field) is left alone", () => {
    expect(shouldRestoreFocus(false, true, false)).toBe(false);
  });

  test("an opener that left the page is not a target (the caller falls back to the page title)", () => {
    expect(shouldRestoreFocus(true, false, false)).toBe(false);
  });
});

// Plain objects stand in for elements: the helper only picks one of them.
const opener = { id: "opener" } as unknown as HTMLElement;
const title = { id: "page-title" } as unknown as HTMLElement;

describe("restoreFocusTarget", () => {
  test("focus on <body> and a usable opener: back to the opener", () => {
    expect(
      restoreFocusTarget({
        activeIsBody: true,
        pending: false,
        opener,
        openerUsable: true,
        fallback: title,
      }),
    ).toBe(opener);
  });

  test("focus on <body> and the opener gone or still disabled: the page title", () => {
    expect(
      restoreFocusTarget({
        activeIsBody: true,
        pending: false,
        opener,
        openerUsable: false,
        fallback: title,
      }),
    ).toBe(title);
    expect(
      restoreFocusTarget({
        activeIsBody: true,
        pending: false,
        opener: null,
        openerUsable: false,
        fallback: title,
      }),
    ).toBe(title);
  });

  test("no opener and no page title: nothing to focus", () => {
    expect(
      restoreFocusTarget({
        activeIsBody: true,
        pending: false,
        opener: null,
        openerUsable: false,
        fallback: null,
      }),
    ).toBeNull();
  });

  test("focus already on an element: nothing moves", () => {
    expect(
      restoreFocusTarget({
        activeIsBody: false,
        pending: false,
        opener,
        openerUsable: true,
        fallback: title,
      }),
    ).toBeNull();
  });

  test("still pending: nothing moves yet", () => {
    expect(
      restoreFocusTarget({
        activeIsBody: true,
        pending: true,
        opener,
        openerUsable: true,
        fallback: title,
      }),
    ).toBeNull();
  });
});
