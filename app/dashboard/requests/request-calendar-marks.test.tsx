import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Calendar } from "@/components/ui/calendar";

import { CalendarLegend, MODIFIER_CLASS_NAMES } from "./request-calendar-marks";

describe("CalendarLegend", () => {
  test("always lists the four marks, one entry each", () => {
    for (const blocks of ["week", "day", null] as const) {
      const html = renderToStaticMarkup(<CalendarLegend blocks={blocks} />);

      expect(html.match(/<li/g)?.length).toBe(4);
    }
  });

  test("a fulfilled daily request is listed as information in every calendar, never as unavailable", () => {
    for (const blocks of ["week", "day", null] as const) {
      const html = renderToStaticMarkup(<CalendarLegend blocks={blocks} />);

      expect(html).toContain("Day has a fulfilled daily request");
    }
  });

  test("the fulfilled-day marker follows the text colour, so it stays visible on a selected day", () => {
    expect(MODIFIER_CLASS_NAMES.dailyFulfilled).toContain("before:border-current");
  });

  test("where weeks block, only the week entries say what cannot be picked", () => {
    const html = renderToStaticMarkup(<CalendarLegend blocks="week" />);

    expect(html).toContain("Week already has a request, unavailable");
    expect(html).toContain("Fulfilled only, a new request is an addition");
    expect(html).toContain("Day has an open daily request");
    expect(html).not.toContain("Day already has a request");
  });

  test("where days block, only the day entry says it cannot be picked", () => {
    const html = renderToStaticMarkup(<CalendarLegend blocks="day" />);

    expect(html).toContain("Day already has a request, unavailable");
    expect(html).toContain("Week has an open or approved request");
    expect(html).toContain("Week has a fulfilled request");
    expect(html).not.toContain("Week already has a request");
  });

  test("where nothing blocks (the roster) every entry is informational", () => {
    const html = renderToStaticMarkup(<CalendarLegend blocks={null} />);

    expect(html).toContain("Week has an open or approved request");
    expect(html).toContain("Week has a fulfilled request");
    expect(html).toContain("Day has an open daily request");
    expect(html).not.toContain("unavailable");
  });
});

describe("the calendar day cells", () => {
  const render = (modifiers: Record<string, Date[]>) =>
    renderToStaticMarkup(
      <Calendar
        mode="single"
        weekStartsOn={1}
        month={new Date(2026, 9, 1)}
        modifiers={modifiers}
        modifiersClassNames={MODIFIER_CLASS_NAMES}
      />,
    );

  // The <td> of one day of October 2026, by its day-button's text.
  const cellOf = (html: string, day: number): string => {
    const cells = html.split("<td").slice(1);
    const cell = cells.find((c) => new RegExp(`>${day}</button>`).test(c));
    if (!cell) throw new Error(`no cell for day ${day}`);
    return cell;
  };

  test("a fulfilled daily day carries the outlined marker on its cell, and its neighbours do not", () => {
    const html = render({ dailyFulfilled: [new Date(2026, 9, 31)] });

    expect(cellOf(html, 31)).toContain("before:border-current");
    expect(cellOf(html, 30)).not.toContain("before:border-current");
  });

  test("an open daily day keeps the solid marker and gets no outlined one", () => {
    const html = render({ daily: [new Date(2026, 9, 31)] });

    expect(cellOf(html, 31)).toContain("before:bg-foreground");
    expect(cellOf(html, 31)).not.toContain("before:border-current");
  });
});
