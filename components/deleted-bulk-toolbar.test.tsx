import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DeletedBulkToolbar } from "./deleted-bulk-toolbar";
import { nounFor } from "@/lib/bulk-summary";

describe("DeletedBulkToolbar", () => {
  const noop = () => {};
  const done = async () => ({ ok: true as const });
  const props = {
    clear: noop,
    noun: nounFor("site"),
    restore: done,
    purge: done,
    bulkPurgeDescription: (count: number) => `Purge ${count}`,
    canPurge: true,
  };

  test("shows the selection count and both verbs", () => {
    const html = renderToStaticMarkup(
      <DeletedBulkToolbar count={2} ids={["a", "b"]} {...props} />,
    );

    expect(html).toContain("2 sites selected");
    expect(html).toContain("Restore");
    expect(html).toContain("Delete permanently");
  });

  test("one selected site reads in the singular", () => {
    const html = renderToStaticMarkup(
      <DeletedBulkToolbar count={1} ids={["a"]} {...props} />,
    );

    expect(html).toContain("1 site selected");
  });

  test("without canPurge there is no permanent delete, only restore", () => {
    const html = renderToStaticMarkup(
      <DeletedBulkToolbar
        count={2}
        ids={["a", "b"]}
        {...props}
        canPurge={false}
      />,
    );

    expect(html).toContain("Restore");
    expect(html).not.toContain("Delete permanently");
  });
});
