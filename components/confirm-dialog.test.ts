import { describe, expect, test } from "bun:test";

import {
  confirmButtonVariant,
  guardedConfirm,
  guardedOpenChange,
  pendingButtonProps,
} from "@/components/confirm-dialog";

// The dialog parts cannot render outside an open dialog, so the close guard
// is pinned through its pure helper.
describe("guardedOpenChange", () => {
  test("while the action runs, a close request (Escape, outside click) is ignored", () => {
    expect(guardedOpenChange(true, false)).toBe(false);
  });

  test("while the action runs, an open request is ignored too", () => {
    expect(guardedOpenChange(true, true)).toBe(false);
  });

  test("when idle, a close request is applied", () => {
    expect(guardedOpenChange(false, false)).toBe(true);
  });

  test("when idle, an open request is applied", () => {
    expect(guardedOpenChange(false, true)).toBe(true);
  });
});

// The confirm button's variant cannot be read from a closed dialog either.
describe("confirmButtonVariant", () => {
  test("defaults to destructive, so existing callers are unchanged", () => {
    expect(confirmButtonVariant(undefined)).toBe("destructive");
  });

  test("destructive stays destructive", () => {
    expect(confirmButtonVariant("destructive")).toBe("destructive");
  });

  test("default gives the primary button style", () => {
    expect(confirmButtonVariant("default")).toBe("default");
  });
});

// While pending the buttons keep focus: they are marked aria-disabled, never
// given the `disabled` attribute (a disabled button drops focus to <body>).
describe("pendingButtonProps", () => {
  test("while the action runs, the buttons are aria-disabled, not disabled", () => {
    const props = pendingButtonProps(true);
    expect(props).toEqual({ "aria-disabled": true });
    expect("disabled" in props).toBe(false);
  });

  test("when idle, no disabled state is set", () => {
    expect(pendingButtonProps(false)).toEqual({});
  });
});

// The confirm button stays clickable to the browser while pending, so the
// dialog ignores the click itself.
describe("guardedConfirm", () => {
  test("while the action runs, a confirm click is ignored", () => {
    expect(guardedConfirm(true)).toBe(false);
  });

  test("when idle, a confirm click runs the action", () => {
    expect(guardedConfirm(false)).toBe(true);
  });
});
