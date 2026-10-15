import { describe, expect, test } from "bun:test";

import {
  ilikePattern,
  parseTableSearchParams,
  TABLE_PAGE_SIZE,
  type RawSearchParams,
} from "./table-params";

const raw = (entries: Record<string, string | string[] | undefined>) =>
  entries as RawSearchParams;

describe("parseTableSearchParams", () => {
  test("empty raw object falls back to defaults", () => {
    expect(parseTableSearchParams(raw({}))).toEqual({
      q: "",
      page: 1,
      sort: null,
      pageSize: 10,
    });
  });

  test("array values use the first element only", () => {
    expect(
      parseTableSearchParams(
        raw({ q: ["alpha", "beta"], page: ["3", "9"], sort: ["name"] }),
      ),
    ).toEqual({
      q: "alpha",
      page: 3,
      sort: { columnId: "name", dir: "asc" },
      pageSize: 10,
    });
  });

  test("q is trimmed; whitespace-only q means no search", () => {
    expect(parseTableSearchParams(raw({ q: "  admin  " })).q).toBe("admin");
    expect(parseTableSearchParams(raw({ q: "   " })).q).toBe("");
  });

  test("page falls back to 1 for NaN, zero, negative, and decimal junk", () => {
    expect(parseTableSearchParams(raw({ page: "0" })).page).toBe(1);
    expect(parseTableSearchParams(raw({ page: "-4" })).page).toBe(1);
    expect(parseTableSearchParams(raw({ page: "abc" })).page).toBe(1);
    expect(parseTableSearchParams(raw({ page: "2abc" })).page).toBe(2);
  });

  test("dir is asc unless exactly desc", () => {
    expect(parseTableSearchParams(raw({ sort: "name", dir: "desc" })).sort).toEqual({
      columnId: "name",
      dir: "desc",
    });
    expect(parseTableSearchParams(raw({ sort: "name", dir: "DESC" })).sort).toEqual({
      columnId: "name",
      dir: "asc",
    });
    expect(parseTableSearchParams(raw({ sort: "name", dir: "sideways" })).sort).toEqual({
      columnId: "name",
      dir: "asc",
    });
  });

  test("sort is null for empty or whitespace values", () => {
    expect(parseTableSearchParams(raw({ sort: "" })).sort).toBeNull();
    expect(parseTableSearchParams(raw({ sort: "  " })).sort).toEqual({
      columnId: "  ",
      dir: "asc",
    });
  });

  describe("pageSize", () => {
    test("defaults to the first whitelist option", () => {
      const options = [10, 20, 30, 40, 50];
      expect(parseTableSearchParams(raw({}), options).pageSize).toBe(10);
      expect(
        parseTableSearchParams(raw({ pageSize: "junk" }), options).pageSize,
      ).toBe(10);
      expect(
        parseTableSearchParams(raw({ pageSize: "-3" }), options).pageSize,
      ).toBe(10);
    });

    test("accepts only whitelisted values", () => {
      const options = [10, 20, 30, 40, 50];
      expect(
        parseTableSearchParams(raw({ pageSize: "20" }), options).pageSize,
      ).toBe(20);
      expect(
        parseTableSearchParams(raw({ pageSize: "50" }), options).pageSize,
      ).toBe(50);
      // Not on the whitelist → default, never an arbitrary limit.
      expect(
        parseTableSearchParams(raw({ pageSize: "7" }), options).pageSize,
      ).toBe(10);
      expect(
        parseTableSearchParams(raw({ pageSize: "99999" }), options).pageSize,
      ).toBe(10);
      expect(
        parseTableSearchParams(raw({ pageSize: "20" }), options).pageSize,
      ).toBe(20);
    });

    test("honors a non-default whitelist", () => {
      expect(
        parseTableSearchParams(raw({ pageSize: "25" }), [25, 75]).pageSize,
      ).toBe(25);
      expect(
        parseTableSearchParams(raw({ pageSize: "10" }), [25, 75]).pageSize,
      ).toBe(25);
    });

    test("without a whitelist the cap is TABLE_PAGE_SIZE", () => {
      expect(parseTableSearchParams(raw({})).pageSize).toBe(10);
      expect(parseTableSearchParams(raw({ pageSize: "50" })).pageSize).toBe(10);
    });
  });
});

describe("TABLE_PAGE_SIZE", () => {
  test("is 10", () => {
    expect(TABLE_PAGE_SIZE).toBe(10);
  });
});

describe("ilikePattern", () => {
  test("empty q yields undefined (no filter)", () => {
    expect(ilikePattern("")).toBeUndefined();
  });

  test("wraps the query in literal % wildcards", () => {
    expect(ilikePattern("admin")).toBe("%admin%");
  });

  test("escapes backslash, percent, and underscore", () => {
    // q="50\%_off" (TS source) → wraps to "%50\\%\_off%" + the literal "off".
    expect(ilikePattern("50\\%_off")).toBe("%50\\\\\\%\\_off%");
  });

  test("leaves non-wildcard characters verbatim", () => {
    expect(ilikePattern("a.c*([x])")).toBe("%a.c*([x])%");
  });
});
