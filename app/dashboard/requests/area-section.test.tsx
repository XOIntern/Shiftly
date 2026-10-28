import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  MpRequestGridShift,
  MpRequestGridWorkArea,
} from "@/types/mp-request";

import { AreaSection } from "./area-section";
import { gridDates, gridRows, groupByArea } from "./request-form";

const LOC_A1 = "aaaa1111-1111-4111-8111-111111111111";
const WA_A1 = "cccc1111-1111-4111-8111-111111111111";
const WA_A2 = "cccc2222-2222-4222-9222-222222222222";
const SH_A1 = "dddd1111-1111-4111-8111-111111111111";
const SH_A2 = "dddd2222-2222-4222-9222-222222222222";
const POS_A1 = "eeee1111-1111-4111-8111-111111111111";
const POS_A2 = "eeee2222-2222-4222-9222-222222222222";
const MONDAY = "2026-01-05";

const activeWorkAreas: MpRequestGridWorkArea[] = [
  {
    id: WA_A1,
    name: "Zone One",
    siteLocationId: LOC_A1,
    positions: [{ id: POS_A1, name: "Operator" }],
  },
  {
    id: WA_A2,
    name: "Zone Two",
    siteLocationId: LOC_A1,
    positions: [{ id: POS_A2, name: "Technician" }],
  },
];
const activeShifts: MpRequestGridShift[] = [
  {
    id: SH_A1,
    label: "Morning",
    siteLocationId: LOC_A1,
    orderIndex: 1,
    startTime: "06:00",
    endTime: "14:00",
  },
  {
    id: SH_A2,
    label: "Evening",
    siteLocationId: LOC_A1,
    orderIndex: 2,
    startTime: "14:00",
    endTime: "22:00",
  },
];

const catalog = gridRows(activeWorkAreas, activeShifts, LOC_A1);
const [zoneOne] = groupByArea(catalog, new Set([WA_A1]));

const weekValues = {
  [`${WA_A1}|${SH_A1}|${POS_A1}|2026-01-05`]: "3",
  [`${WA_A1}|${SH_A2}|${POS_A1}|2026-01-05`]: "2",
  [`${WA_A1}|${SH_A1}|${POS_A1}|2026-01-07`]: "4",
};

// Mirrors what RequestForm threads in for one added area.
function render(
  props: Partial<ComponentProps<typeof AreaSection>> & {
    type?: "weekly" | "daily";
  } = {},
) {
  const type = props.type ?? "weekly";
  const dates = props.dates ?? gridDates(type, MONDAY);
  const group = props.group ?? zoneOne!;
  const values = props.values ?? weekValues;
  return renderToStaticMarkup(
    <AreaSection
      group={group}
      open
      type={type}
      dates={dates}
      values={values}
      quickFill={{}}
      rows={group.rows}
      fieldErrors={{}}
      onToggle={() => {}}
      onRemove={() => {}}
      onCellChange={() => {}}
      onQuickFillChange={() => {}}
      onFillRow={() => {}}
      {...props}
    />,
  );
}

describe("AreaSection", () => {
  test("an added area renders its section with every shift × required position row and the per-day totals in the header", () => {
    const html = render();

    expect(html.includes("<section")).toBeTrue();
    for (const shift of ["Morning", "Evening"]) {
      for (const date of gridDates("weekly", MONDAY)) {
        expect(
          html.includes(
            `aria-label="Headcount Zone One / ${shift} / Operator / ${date}"`,
          ),
        ).toBeTrue();
      }
    }
    expect(html.includes("Headcount Zone Two")).toBeFalse();
    // The typed values sit in their cells.
    expect(html.includes('value="3"')).toBeTrue();
    expect(html.includes('value="4"')).toBeTrue();
    // Header: name, per-day totals and the week total.
    expect(html.includes(">Zone One<")).toBeTrue();
    expect(html.includes(">Mon 5<")).toBeTrue();
    expect(html.includes(">Tue 0<")).toBeTrue();
    expect(html.includes(">Wed 4<")).toBeTrue();
    expect(html.includes(">Week 9<")).toBeTrue();
    // The disclosure is a real button that reports its state.
    expect(/<button[^>]*aria-expanded="true"/.test(html)).toBeTrue();
    expect(html.includes('aria-label="Remove area Zone One"')).toBeTrue();
    // Weekly rows carry the "same all days" quick fill.
    expect(html.includes(">Same all days<")).toBeTrue();
    expect(
      html.includes('aria-label="Same all days Zone One / Morning / Operator"'),
    ).toBeTrue();
    expect(
      html.includes(
        'aria-label="Fill every day Zone One / Morning / Operator"',
      ),
    ).toBeTrue();
  });

  test("the disclosure button holds no list markup; its name is the area title and the totals describe it", () => {
    const html = render();
    const button = /<button[^>]*aria-expanded[\s\S]*?<\/button>/.exec(html)![0];

    expect(button.includes("<ul")).toBeFalse();
    expect(button.includes("<li")).toBeFalse();
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(button)![1]!;
    const describedBy = /aria-describedby="([^"]+)"/.exec(button)![1]!;
    expect(
      new RegExp(`id="${labelledBy}"[^>]*>Zone One<`).test(html),
    ).toBeTrue();
    const totalsSpan = new RegExp(
      `<span[^>]*id="${describedBy}"[^>]*>([\\s\\S]*?)</span>\\s*</span>`,
    ).exec(html);
    expect(totalsSpan).not.toBeNull();
    expect(totalsSpan![1]!.includes("Mon 5")).toBeTrue();
    expect(totalsSpan![1]!.includes("Week 9")).toBeTrue();
    // The title is not part of the description.
    expect(totalsSpan![1]!.includes("Zone One")).toBeFalse();
  });

  test("a collapsed area hides its body and reports aria-expanded=false", () => {
    const html = render({ open: false });

    expect(/<button[^>]*aria-expanded="false"/.test(html)).toBeTrue();
    expect(html.includes(`id="request-area-${WA_A1}" hidden=""`)).toBeTrue();
  });

  test("daily: a single date column, no day columns and no quick fill", () => {
    const values = { [`${WA_A1}|${SH_A1}|${POS_A1}|2026-01-07`]: "6" };
    const html = render({
      type: "daily",
      dates: gridDates("daily", "2026-01-07"),
      values,
    });

    expect(html.includes(">Headcount<")).toBeTrue();
    expect(html.includes(">Mon<")).toBeFalse();
    expect(html.includes("Same all days")).toBeFalse();
    expect(
      html.includes(
        'aria-label="Headcount Zone One / Morning / Operator / 2026-01-07"',
      ),
    ).toBeTrue();
    expect(html.includes("2026-01-08")).toBeFalse();
    expect(html.includes(">Total 6<")).toBeTrue();
  });

  test("a lines.<i> refusal renders under the row at that index", () => {
    const html = render({
      fieldErrors: { "lines.1.headcount": "Headcount must be at most 999" },
    });

    // Row 1 is Zone One / Evening / Operator: the message follows its inputs.
    expect(
      /Headcount Zone One \/ Evening \/ Operator \/ 2026-01-11"[\s\S]*Headcount must be at most 999/.test(
        html,
      ),
    ).toBeTrue();
    expect(html.match(/Headcount must be at most 999/g)).toHaveLength(1);
  });
});
