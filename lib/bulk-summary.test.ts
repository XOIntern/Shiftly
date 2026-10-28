import { describe, expect, test } from "bun:test";

import { nounFor, summarizeBulk } from "./bulk-summary";

const site = nounFor("site");

describe("nounFor", () => {
  test("defaults the plural to the singular plus s; one is singular", () => {
    expect(site(0)).toBe("sites");
    expect(site(1)).toBe("site");
    expect(site(2)).toBe("sites");
  });

  test("handles a multi-word noun", () => {
    expect(nounFor("work area")(2)).toBe("work areas");
  });

  test("takes an explicit plural", () => {
    expect(nounFor("person", "people")(2)).toBe("people");
    expect(nounFor("person", "people")(1)).toBe("person");
  });
});

describe("summarizeBulk", () => {
  test("counts what went through, singular and plural", () => {
    expect(
      summarizeBulk({ ok: true, applied: 1, blocked: 0 }, "restored", site),
    ).toEqual({ kind: "success", title: "1 site restored" });
    expect(
      summarizeBulk({ ok: true, applied: 3, blocked: 0 }, "restored", site),
    ).toEqual({ kind: "success", title: "3 sites restored" });
  });

  test("a partial result says how many were skipped and why", () => {
    expect(
      summarizeBulk(
        {
          ok: true,
          applied: 2,
          blocked: 1,
          message: "1 site skipped: Site has audit history",
        },
        "deleted permanently",
        site,
      ),
    ).toEqual({
      kind: "success",
      title: "2 sites deleted permanently, 1 skipped",
      description: "1 site skipped: Site has audit history",
    });
  });

  test("nothing went through is reported as an error with the reason", () => {
    expect(
      summarizeBulk(
        {
          ok: true,
          applied: 0,
          blocked: 2,
          message: "2 sites skipped: Deleted site not found.",
        },
        "restored",
        site,
      ),
    ).toEqual({
      kind: "error",
      title: "2 sites skipped: Deleted site not found.",
    });
  });

  test("a failed action shows its own message", () => {
    expect(
      summarizeBulk(
        { ok: false, message: "No sites selected." },
        "restored",
        site,
      ),
    ).toEqual({ kind: "error", title: "No sites selected." });
  });

  test("a failed action without a message falls back to a generic one", () => {
    const summary = summarizeBulk({ ok: false }, "restored", site);

    expect(summary.kind).toBe("error");
    expect(summary.title.length).toBeGreaterThan(0);
  });
});
