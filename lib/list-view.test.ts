import { describe, expect, test } from "bun:test";

import { nextListParams, parseListView } from "./list-view";

describe("parseListView", () => {
  test("the exact token selects the deleted view", () => {
    expect(parseListView("deleted")).toBe("deleted");
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
    expect(parseListView(raw)).toBe("active");
  });
});

describe("nextListParams", () => {
  const current = () =>
    new URLSearchParams("q=foo&status=active&sort=name%3Adesc&page=3");

  test("choosing the deleted list sets show and restarts at page 1", () => {
    const next = nextListParams(current(), "deleted");

    expect(next.get("show")).toBe("deleted");
    expect(next.get("page")).toBe("1");
  });

  test("a switch keeps the search term and the status but drops the sort", () => {
    const next = nextListParams(current(), "deleted");

    expect(next.get("q")).toBe("foo");
    expect(next.get("status")).toBe("active");
    expect(next.has("sort")).toBe(false);
  });

  test("choosing the active list removes show", () => {
    const params = current();
    params.set("show", "deleted");

    const next = nextListParams(params, "active");

    expect(next.has("show")).toBe(false);
    expect(next.get("q")).toBe("foo");
  });

  test("an unknown value is the active list", () => {
    const params = current();
    params.set("show", "deleted");

    expect(nextListParams(params, "bogus").has("show")).toBe(false);
    expect(nextListParams(params, null).has("show")).toBe(false);
  });

  test("does not mutate the params it was given", () => {
    const params = current();

    nextListParams(params, "deleted");

    expect(params.has("show")).toBe(false);
    expect(params.get("status")).toBe("active");
  });
});
