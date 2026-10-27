import { describe, expect, test } from "bun:test";
import { shouldRefreshAfter } from "./refresh-after";

describe("shouldRefreshAfter", () => {
  test("a failed result refreshes, whatever its message", () => {
    expect(shouldRefreshAfter({ ok: false })).toBe(true);
    expect(
      shouldRefreshAfter({ ok: false, message: "Roster not found." } as {
        ok: boolean;
      }),
    ).toBe(true);
    expect(
      shouldRefreshAfter({ ok: false, message: "" } as { ok: boolean }),
    ).toBe(true);
  });

  test("a successful result does not refresh", () => {
    expect(shouldRefreshAfter({ ok: true })).toBe(false);
  });
});
