import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DeletedSitesToolbar } from "./deleted-sites-toolbar";

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
