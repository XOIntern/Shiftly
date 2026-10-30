import { describe, expect, mock, test } from "bun:test";
import * as realNavigation from "next/navigation";

// The module reads navigation hooks only when a component renders; the real
// module is spread back in because bun's module mocks are process-wide.
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/roster",
  useSearchParams: () => new URLSearchParams(),
}));

const { generateSuccessToast } = await import("./roster-plan-actions");

describe("generateSuccessToast", () => {
  test("a plain success carries only the title", () => {
    expect(generateSuccessToast({ ok: true })).toEqual({
      title: "Draft roster generated.",
      options: {},
    });
  });

  test("the note about held-back workers rides along and stays on screen long enough to read", () => {
    const toast = generateSuccessToast({
      ok: true,
      message: "Daily fills already break a rule: W1: max is 1",
    });

    expect(toast.title).toBe("Draft roster generated.");
    expect(toast.options.description).toBe(
      "Daily fills already break a rule: W1: max is 1",
    );
    expect(toast.options.duration).toBeGreaterThanOrEqual(10_000);
  });
});
