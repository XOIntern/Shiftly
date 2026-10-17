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
      sorts: [],
      status: null,
      role: null,
      siteId: null,
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
      sorts: [{ columnId: "name", dir: "asc" }],
      status: null,
      role: null,
      siteId: null,
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

  test("dir is asc unless exactly desc (legacy single-sort form)", () => {
    expect(parseTableSearchParams(raw({ sort: "name", dir: "desc" })).sorts).toEqual([
      { columnId: "name", dir: "desc" },
    ]);
    expect(parseTableSearchParams(raw({ sort: "name", dir: "DESC" })).sorts).toEqual([
      { columnId: "name", dir: "asc" },
    ]);
    expect(
      parseTableSearchParams(raw({ sort: "name", dir: "sideways" })).sorts,
    ).toEqual([{ columnId: "name", dir: "asc" }]);
  });

  test("empty or whitespace-only sort parses to no sorts", () => {
    expect(parseTableSearchParams(raw({ sort: "" })).sorts).toEqual([]);
    expect(parseTableSearchParams(raw({ sort: "  " })).sorts).toEqual([]);
  });

  describe("multi-sort", () => {
    test("parses a comma-separated columnId:dir list in priority order", () => {
      expect(
        parseTableSearchParams(raw({ sort: "isActive:asc,name:desc" })).sorts,
      ).toEqual([
        { columnId: "isActive", dir: "asc" },
        { columnId: "name", dir: "desc" },
      ]);
    });

    test("a pair without a dir falls back to asc", () => {
      expect(parseTableSearchParams(raw({ sort: "name:" })).sorts).toEqual([
        { columnId: "name", dir: "asc" },
      ]);
    });

    test("empty segments and blank column ids are skipped", () => {
      expect(
        parseTableSearchParams(raw({ sort: ",name:asc,,b:desc," })).sorts,
      ).toEqual([
        { columnId: "name", dir: "asc" },
        { columnId: "b", dir: "desc" },
      ]);
      expect(parseTableSearchParams(raw({ sort: "," })).sorts).toEqual([]);
    });

    test("duplicate column ids keep the first occurrence only", () => {
      expect(
        parseTableSearchParams(raw({ sort: "name:asc,name:desc" })).sorts,
      ).toEqual([{ columnId: "name", dir: "asc" }]);
    });

    test("the list is capped at three levels", () => {
      expect(
        parseTableSearchParams(
          raw({ sort: "a:asc,b:desc,c:asc,d:desc" }),
        ).sorts,
      ).toEqual([
        { columnId: "a", dir: "asc" },
        { columnId: "b", dir: "desc" },
        { columnId: "c", dir: "asc" },
      ]);
    });
  });

  describe("role", () => {
    test("is null when the param is absent or empty", () => {
      expect(parseTableSearchParams(raw({})).role).toBeNull();
      expect(parseTableSearchParams(raw({ role: "" })).role).toBeNull();
    });

    test("parses the whitelist values exactly", () => {
      expect(parseTableSearchParams(raw({ role: "superadmin" })).role).toBe(
        "superadmin",
      );
      expect(parseTableSearchParams(raw({ role: "ho" })).role).toBe("ho");
      expect(parseTableSearchParams(raw({ role: "admin" })).role).toBe("admin");
    });

    test("is null for anything outside the whitelist", () => {
      expect(parseTableSearchParams(raw({ role: "ADMIN" })).role).toBeNull();
      expect(parseTableSearchParams(raw({ role: "junk" })).role).toBeNull();
      // Array values use the first element, like q/page/sort do.
      expect(parseTableSearchParams(raw({ role: ["ho", "junk"] })).role).toBe(
        "ho",
      );
    });
  });

  describe("siteId", () => {
    test("is null when the param is absent or empty", () => {
      expect(parseTableSearchParams(raw({})).siteId).toBeNull();
      expect(parseTableSearchParams(raw({ siteId: "" })).siteId).toBeNull();
    });

    test("parses a well-formed uuid", () => {
      const uuid = "123e4567-e89b-12d3-a456-426614174000";
      expect(parseTableSearchParams(raw({ siteId: uuid })).siteId).toBe(uuid);
    });

    test("is null for anything that is not a uuid shape", () => {
      // The whitelist is dynamic (site ids live in the DB), so only the
      // shape is gated here — an unknown-but-valid uuid yields an empty
      // result, never a SQL error.
      expect(
        parseTableSearchParams(raw({ siteId: "not-a-uuid" })).siteId,
      ).toBeNull();
      expect(
        parseTableSearchParams(raw({ siteId: "123e4567-e89b-12d3-a456" }))
          .siteId,
      ).toBeNull();
      // Array values use the first element, like q/page/sort do.
      expect(
        parseTableSearchParams(raw({ siteId: ["not-a-uuid", "123e4567-e89b-12d3-a456-426614174000"] }))
          .siteId,
      ).toBeNull();
    });
  });

  describe("status", () => {
    test("is null when the param is absent or empty", () => {
      expect(parseTableSearchParams(raw({})).status).toBeNull();
      expect(parseTableSearchParams(raw({ status: "" })).status).toBeNull();
    });

    test("parses the whitelist values exactly", () => {
      expect(parseTableSearchParams(raw({ status: "active" })).status).toBe(
        "active",
      );
      expect(parseTableSearchParams(raw({ status: "inactive" })).status).toBe(
        "inactive",
      );
    });

    test("is null for anything outside the whitelist", () => {
      expect(parseTableSearchParams(raw({ status: "ACTIVE" })).status).toBeNull();
      expect(parseTableSearchParams(raw({ status: "junk" })).status).toBeNull();
      // Array values use the first element, like q/page/sort do.
      expect(
        parseTableSearchParams(raw({ status: ["active", "junk"] })).status,
      ).toBe("active");
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
