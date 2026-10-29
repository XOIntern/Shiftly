import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RosterWeekPicker } from "./roster-week-picker";

const LOC = "aaaaaaaa-1111-4111-8111-111111111111";

function render(overrides: Partial<Parameters<typeof RosterWeekPicker>[0]> = {}) {
  return renderToStaticMarkup(
    <RosterWeekPicker
      week="2026-10-12"
      locationId={LOC}
      onChange={() => {}}
      {...overrides}
    />,
  );
}

describe("RosterWeekPicker", () => {
  test("the trigger names the field and shows the week's Monday", () => {
    const html = render();

    expect(html).toMatch(/aria-label="Week start, [^"]*12 Oct 2026"/);
    expect(html).toMatch(/<span>[^<]*12 Oct 2026<\/span>/);
  });

  test("it is a calendar trigger, not a native date input", () => {
    const html = render();

    expect(html).not.toContain('type="date"');
    expect(html).toContain("<button");
  });

  test("with no location resolved the trigger still renders", () => {
    const html = render({ locationId: null });

    expect(html).toMatch(/aria-label="Week start, [^"]*12 Oct 2026"/);
  });
});
