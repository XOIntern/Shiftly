import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CalendarLegend } from "./request-calendar-marks";

describe("CalendarLegend", () => {
  test("always lists the three marks, one entry each", () => {
    for (const blocks of ["week", "day", null] as const) {
      const html = renderToStaticMarkup(<CalendarLegend blocks={blocks} />);

      expect(html.match(/<li/g)?.length).toBe(3);
    }
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
