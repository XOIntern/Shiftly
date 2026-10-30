import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const { RequirementsPanel } = await import("./requirements-panel");
type PanelProps = Parameters<typeof RequirementsPanel>[0];

const SITE_LOC = "aaaaaaaa-1111-4111-8111-111111111111";
const AREA_PACKING = "cccccccc-1111-4111-8111-111111111111";
const AREA_COLD = "cccccccc-2222-4222-9222-222222222222";
const SHIFT_1 = "dddddddd-1111-4111-8111-111111111111";
const SHIFT_2 = "dddddddd-2222-4222-9222-222222222222";
const POS_OPERATOR = "eeeeeeee-1111-4111-8111-111111111111";
const POS_FORKLIFT = "eeeeeeee-2222-4222-9222-222222222222";
const REQ_DAILY = "ffffffff-1111-4111-8111-111111111111";

const weeklyShort: PanelProps["rows"][number] = {
  key: `weekly|${AREA_PACKING}|${SHIFT_1}|week`,
  source: "weekly",
  workAreaId: AREA_PACKING,
  shiftDefId: SHIFT_1,
  date: null,
  positions: [
    { positionId: POS_OPERATOR, headcount: 6 },
    { positionId: POS_FORKLIFT, headcount: 4 },
  ],
  required: 50,
  filled: 42,
};
const weeklyFull: PanelProps["rows"][number] = {
  key: `weekly|${AREA_COLD}|${SHIFT_2}|week`,
  source: "weekly",
  workAreaId: AREA_COLD,
  shiftDefId: SHIFT_2,
  date: null,
  positions: [{ positionId: POS_OPERATOR, headcount: 12 }],
  required: 12,
  filled: 12,
};
const daily: PanelProps["rows"][number] = {
  key: `daily|${AREA_PACKING}|${SHIFT_1}|2026-11-05`,
  source: "daily",
  workAreaId: AREA_PACKING,
  shiftDefId: SHIFT_1,
  date: "2026-11-05",
  positions: [{ positionId: POS_OPERATOR, headcount: 2, requestId: REQ_DAILY }],
  required: 2,
  filled: 0,
};

const base: PanelProps = {
  rows: [weeklyShort, weeklyFull, daily],
  areaNames: { [AREA_PACKING]: "Packing", [AREA_COLD]: "Cold Store" },
  shiftLabels: { [SHIFT_1]: "Shift 1", [SHIFT_2]: "Shift 2" },
  positionNames: { [POS_OPERATOR]: "Operator", [POS_FORKLIFT]: "Forklift" },
  selectedWorkAreaId: AREA_COLD,
  onSelectWorkArea: () => {},
  canFill: true,
  weeklyPublished: true,
  siteLocationId: SITE_LOC,
};

const render = (overrides: Partial<PanelProps> = {}) =>
  renderToStaticMarkup(<RequirementsPanel {...base} {...overrides} />);
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("RequirementsPanel", () => {
  test('a weekly row renders "Packing · Shift 1", the demanded positions "Operator 6 · Forklift 4", and progress "42/50"', () => {
    const rendered = text(render({ rows: [weeklyShort] }));
    expect(rendered).toContain("Packing · Shift 1");
    expect(rendered).toContain("Operator 6 · Forklift 4");
    expect(rendered).toContain("42/50");
  });

  test("a short row shows the warning mark, a full row does not", () => {
    const short = render({ rows: [weeklyShort] });
    expect(short).toContain('aria-label="Short by 8"');
    expect(text(short)).toContain("8 short");

    const full = render({ rows: [weeklyFull] });
    expect(full).not.toContain("Short by");
    expect(text(full)).toContain("12/12");
    expect(text(full)).not.toContain("short");
  });

  test('daily rows render the "daily · 2026-11-05" tag', () => {
    const rendered = text(render({ rows: [daily] }));
    expect(rendered).toContain("daily · 2026-11-05");
    expect(rendered).toContain("Packing · Shift 1");
    expect(rendered).toContain("Operator 2");
    expect(rendered).toContain("0/2");
  });

  test("the row of the selected work area is marked selected (aria-current)", () => {
    const html = render({
      rows: [weeklyShort, weeklyFull],
      selectedWorkAreaId: AREA_COLD,
    });
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    const coldButton = html.slice(html.lastIndexOf("<button"));
    expect(coldButton).toContain('aria-current="true"');
    expect(coldButton).toContain("Cold Store");
    const packingButton = html.slice(
      html.indexOf("<button"),
      html.lastIndexOf("<button"),
    );
    expect(packingButton).not.toContain("aria-current");
  });

  test("a weekly row is a real button", () => {
    const html = render({ rows: [weeklyShort] });
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>/);
  });

  test("no rows renders an empty-state line pointing to Requests", () => {
    const html = render({ rows: [] });
    expect(html).toContain('href="/dashboard/requests"');
    expect(text(html)).toContain("No approved requests for this week");
  });

  test("canFill false renders daily rows without the suggestion trigger", () => {
    const readOnly = render({ rows: [daily], canFill: false });
    expect(text(readOnly)).toContain("daily · 2026-11-05");
    expect(readOnly).not.toContain("Suggest replacements");

    expect(render({ rows: [daily], canFill: true })).toContain(
      "Suggest replacements",
    );
  });

  // The opening tag of the "Suggest replacements" trigger, so the disabled
  // assertions are about that button and not any other on the page.
  const suggestTrigger = (html: string): string => {
    const label = html.indexOf("Suggest replacements");
    const start = html.lastIndexOf("<button", label);
    return html.slice(start, html.indexOf(">", start) + 1);
  };

  test("without a published weekly plan the suggestion trigger is disabled and the panel says to publish first", () => {
    const html = render({ rows: [daily], weeklyPublished: false });
    expect(suggestTrigger(html)).toContain('disabled=""');
    expect(text(html)).toContain("Publish the weekly roster first");
  });

  test("with a published weekly plan the suggestion trigger is enabled and no publish-first note shows", () => {
    const html = render({ rows: [daily], weeklyPublished: true });
    expect(suggestTrigger(html)).not.toContain('disabled=""');
    expect(text(html)).not.toContain("Publish the weekly roster first");
  });

  test("the publish-first note needs a daily row: weekly rows alone never show it", () => {
    const html = render({ rows: [weeklyShort], weeklyPublished: false });
    expect(text(html)).not.toContain("Publish the weekly roster first");
  });

  test("a read-only viewer never sees the publish-first note", () => {
    const html = render({
      rows: [daily],
      canFill: false,
      weeklyPublished: false,
    });
    expect(text(html)).not.toContain("Publish the weekly roster first");
  });
});
