import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TotalsRow } from "./totals-row";

const WEEK = [
  "2026-01-05",
  "2026-01-06",
  "2026-01-07",
  "2026-01-08",
  "2026-01-09",
  "2026-01-10",
  "2026-01-11",
];

describe("TotalsRow", () => {
  test("weekly: a Total row with each day's sum and the week total", () => {
    const html = renderToStaticMarkup(
      <TotalsRow
        dates={WEEK}
        totals={[5, 0, 4, 0, 0, 0, 0]}
        weekTotal={9}
        weekly
      />,
    );

    expect(/>Total<[\s\S]*>5<[\s\S]*>9</.test(html)).toBeTrue();
    // Each day cell names its day for screen readers.
    expect(html.includes('<span class="sr-only">Mon </span>5</td>')).toBeTrue();
    expect(html.includes('<span class="sr-only">Wed </span>4</td>')).toBeTrue();
    expect(
      html.includes('<span class="sr-only">Week total </span>9'),
    ).toBeTrue();
    // Inside the shared grid shell, so the columns line up with the sections.
    expect(html.includes("overflow-x-auto")).toBeTrue();
    expect(html.includes("table-fixed")).toBeTrue();
    expect(html.match(/<col /g)).toHaveLength(1 + WEEK.length + 1);
  });

  test("daily: a single total cell and no week total", () => {
    const html = renderToStaticMarkup(
      <TotalsRow
        dates={["2026-01-07"]}
        totals={[6]}
        weekTotal={6}
        weekly={false}
      />,
    );

    expect(html.includes(">Total<")).toBeTrue();
    expect(html.includes(">6</td>")).toBeTrue();
    expect(html.includes("sr-only")).toBeFalse();
    expect(html.includes("Week total")).toBeFalse();
  });
});
