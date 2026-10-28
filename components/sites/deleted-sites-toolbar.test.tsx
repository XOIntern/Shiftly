import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DeletedSitesToolbar,
  bulkPurgeDescription,
  summarizeBulk,
} from "./deleted-sites-toolbar";

describe("summarizeBulk", () => {
  test("counts what went through, singular and plural", () => {
    expect(
      summarizeBulk({ ok: true, applied: 1, blocked: 0 }, "restored"),
    ).toEqual({ kind: "success", title: "1 site restored" });
    expect(
      summarizeBulk({ ok: true, applied: 3, blocked: 0 }, "restored"),
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
      ),
    ).toEqual({
      kind: "error",
      title: "2 sites skipped: Deleted site not found.",
    });
  });

  test("a failed action shows its own message", () => {
    expect(
      summarizeBulk({ ok: false, message: "No sites selected." }, "restored"),
    ).toEqual({ kind: "error", title: "No sites selected." });
  });

  test("a failed action without a message falls back to a generic one", () => {
    const summary = summarizeBulk({ ok: false }, "restored");

    expect(summary.kind).toBe("error");
    expect(summary.title.length).toBeGreaterThan(0);
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 sites");
    expect(text).toContain("cannot be undone");
  });

  test("a single site reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 site ");
  });

  test("says what goes with the sites and what makes one be skipped", () => {
    const text = bulkPurgeDescription(2);

    for (const part of ["locations", "workers", "users"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("roster, request or audit history");
  });
});

describe("DeletedSitesToolbar", () => {
  const noop = () => {};

  test("shows the selection count and both verbs", () => {
    const html = renderToStaticMarkup(
      <DeletedSitesToolbar count={2} ids={["a", "b"]} clear={noop} />,
    );

    expect(html).toContain("2 sites selected");
    expect(html).toContain("Restore");
    expect(html).toContain("Delete permanently");
  });

  test("one selected site reads in the singular", () => {
    const html = renderToStaticMarkup(
      <DeletedSitesToolbar count={1} ids={["a"]} clear={noop} />,
    );

    expect(html).toContain("1 site selected");
  });
});
