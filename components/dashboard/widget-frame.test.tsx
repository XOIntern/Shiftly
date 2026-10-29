import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WidgetEmpty,
  WidgetError,
  WidgetFrame,
  WidgetSkeleton,
} from "./widget-frame";

describe("widget frame", () => {
  test("WidgetFrame shows its title and children", () => {
    const html = renderToStaticMarkup(
      <WidgetFrame title="Needs action">
        <p>inside</p>
      </WidgetFrame>,
    );
    expect(html.includes("Needs action")).toBeTrue();
    expect(html.includes("inside")).toBeTrue();
  });

  test("WidgetError keeps the title and a fixed message, never the thrown one", () => {
    const html = renderToStaticMarkup(<WidgetError title="Locations" />);
    expect(html.includes("Locations")).toBeTrue();
    expect(html.includes("Couldn&#x27;t load this section.")).toBeTrue();
    expect(html.includes("db down")).toBeFalse();
  });

  test("every widget state exposes its title as a level-2 heading", () => {
    const heading = /<div[^>]*role="heading"[^>]*aria-level="2"[^>]*>/;
    for (const node of [
      <WidgetFrame key="f" title="Needs action">
        <p>inside</p>
      </WidgetFrame>,
      <WidgetError key="e" title="Needs action" />,
      <WidgetSkeleton key="s" title="Needs action" />,
    ]) {
      const html = renderToStaticMarkup(node);
      expect(heading.test(html)).toBeTrue();
      expect(html.match(/role="heading"/g)).toHaveLength(1);
    }
  });

  test("WidgetEmpty renders its children", () => {
    const html = renderToStaticMarkup(
      <WidgetEmpty>Nothing needs action right now.</WidgetEmpty>,
    );
    expect(html.includes("Nothing needs action right now.")).toBeTrue();
  });

  test("WidgetSkeleton keeps the title while loading", () => {
    const html = renderToStaticMarkup(<WidgetSkeleton title="Recent activity" />);
    expect(html.includes("Recent activity")).toBeTrue();
    expect(html.includes("animate-pulse")).toBeTrue();
  });
});
