import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RequestGridShell } from "./request-grid-shell";

const WEEK = [
  "2026-01-05",
  "2026-01-06",
  "2026-01-07",
  "2026-01-08",
  "2026-01-09",
  "2026-01-10",
  "2026-01-11",
];

describe("RequestGridShell", () => {
  test("wraps its children in a scroll container holding a fixed-layout table", () => {
    const html = renderToStaticMarkup(
      <RequestGridShell dates={WEEK} tail>
        <tbody>
          <tr>
            <td>cell</td>
          </tr>
        </tbody>
      </RequestGridShell>,
    );

    expect(
      /^<div class="relative overflow-x-auto"><table class="w-max min-w-full table-fixed border-collapse text-sm">/.test(
        html,
      ),
    ).toBeTrue();
    expect(html.includes("<td>cell</td>")).toBeTrue();
    // One label column, one per date, and the weekly tail column.
    expect(html.match(/<col /g)).toHaveLength(1 + WEEK.length + 1);
    expect(html.includes('<col class="w-44"/>')).toBeTrue();
    expect(html.includes('<col class="w-16"/>')).toBeTrue();
    expect(html.includes('<col class="w-32"/>')).toBeTrue();
  });

  test("no tail column without the tail", () => {
    const html = renderToStaticMarkup(
      <RequestGridShell dates={["2026-01-07"]} tail={false}>
        <tbody />
      </RequestGridShell>,
    );

    expect(html.match(/<col /g)).toHaveLength(2);
    expect(html.includes("w-32")).toBeFalse();
  });

  test("extends the container and table classes and renders the footer after the table", () => {
    const html = renderToStaticMarkup(
      <RequestGridShell
        dates={["2026-01-07"]}
        tail={false}
        id="request-area-x"
        hidden
        className="rounded-md border"
        tableClassName="tabular-nums"
        footer={<div>footer</div>}
      >
        <tbody />
      </RequestGridShell>,
    );

    expect(
      html.startsWith(
        '<div id="request-area-x" hidden="" class="relative overflow-x-auto rounded-md border">',
      ),
    ).toBeTrue();
    expect(
      html.includes(
        '<table class="w-max min-w-full table-fixed border-collapse text-sm tabular-nums">',
      ),
    ).toBeTrue();
    expect(html.endsWith("</table><div>footer</div></div>")).toBeTrue();
  });
});
