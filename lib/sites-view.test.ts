import { describe, expect, test } from "bun:test";

import { parseSitesView } from "./sites-view";

describe("parseSitesView", () => {
  test("the exact token selects the deleted view", () => {
    expect(parseSitesView("deleted")).toBe("deleted");
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["the active token", "active"],
    ["another case", "DELETED"],
    ["padded", "deleted "],
    ["a one-element array", ["deleted"]],
    ["a repeated param", ["deleted", "active"]],
  ])("%s falls back to the active view", (_name, raw) => {
    expect(parseSitesView(raw)).toBe("active");
  });
});
