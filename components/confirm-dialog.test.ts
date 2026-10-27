import { describe, expect, test } from "bun:test";

import {
  confirmButtonVariant,
  guardedOpenChange,
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
