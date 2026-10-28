import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// mock.module is process-wide in bun: spread the real module back in so other
// suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/attendance",
  useSearchParams: () => new URLSearchParams(),
}));

const { AttendanceDayView } = await import("./attendance-day-view");

import type { DayData } from "@/types/attendance";

// The day list is built client-side from DayData: roster rows joined to the
// recorded attendance. Ids are short strings here, the markup is what counts.
const EARLY = "shift-early";
const LATE = "shift-late";
const KITCHEN = "area-kitchen";
const PACKING = "area-packing";

function dayData(overrides: Partial<DayData> = {}): DayData {
  return {
    roster: [
      { workerId: "w1", workAreaId: KITCHEN, shiftDefId: EARLY },
      { workerId: "w2", workAreaId: KITCHEN, shiftDefId: EARLY },
      { workerId: "w3", workAreaId: PACKING, shiftDefId: EARLY },
    ],
    records: [
      {
        id: "r2",
        workerId: "w2",
        shiftDefId: EARLY,
        workAreaId: KITCHEN,
        status: "present",
        withoutRoster: false,
        rosteredShiftDefId: EARLY,
        reason: null,
      },
      {
        id: "r3",
        workerId: "w3",
        shiftDefId: LATE,
        workAreaId: PACKING,
        status: "sick",
        withoutRoster: false,
        rosteredShiftDefId: EARLY,
        reason: null,
      },
      {
        id: "r4",
        workerId: "w4",
        shiftDefId: LATE,
        workAreaId: PACKING,
        status: "absent",
        withoutRoster: true,
        rosteredShiftDefId: null,
        reason: "Covering the late shift",
      },
    ],
    workers: {
      w1: { employeeId: "EMP-001", name: "Budi Santoso" },
      w2: { employeeId: "EMP-002", name: "Sari Wulandari" },
      w3: { employeeId: "EMP-003", name: "Dewi Lestari" },
      w4: { employeeId: "EMP-004", name: "Agus Prasetyo" },
    },
    shifts: [
      { id: EARLY, label: "Early", startTime: "06:00", endTime: "14:00", selectable: true },
      { id: LATE, label: "Late", startTime: "14:00", endTime: "22:00", selectable: true },
    ],
    areas: [
      { id: KITCHEN, name: "Kitchen", selectable: true },
      { id: PACKING, name: "Packing", selectable: true },
    ],
    candidates: [],
    timezone: "Asia/Makassar",
    ...overrides,
  };
}

type Props = Parameters<typeof AttendanceDayView>[0];

function render(overrides: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <AttendanceDayView
      date="2026-01-07"
      canWrite={true}
      future={false}
      locationOptions={[{ id: "loc-1", label: "Cikarang Plant" }]}
      locationId="loc-1"
      data={dayData()}
      shiftId={null}
      areaId={null}
      {...overrides}
    />,
  );
}

// Visible text only: tags (and React's text-node comments) stripped.
const text = (html: string): string => html.replace(/<[^>]+>/g, "");
const tbody = (html: string): string =>
  html.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? "";
const summaryCount = (html: string, label: string): string | undefined =>
  html.match(new RegExp(`${label}</dt><dd[^>]*>(\\d+)<`))?.[1];

describe("AttendanceDayView rows", () => {
  test("each row shows the employee id with the worker name under it", () => {
    const body = text(tbody(render()));

    for (const needle of [
      "EMP-001",
      "Budi Santoso",
      "EMP-002",
      "Sari Wulandari",
      "EMP-003",
      "Dewi Lestari",
      "EMP-004",
      "Agus Prasetyo",
    ]) {
      expect(body).toContain(needle);
    }
    expect(text(tbody(render())).indexOf("EMP-001")).toBeLessThan(
      text(tbody(render())).indexOf("Budi Santoso"),
    );
  });

  test("rows are ordered by employee id", () => {
    const body = text(tbody(render()));

    expect(body.indexOf("EMP-001")).toBeLessThan(body.indexOf("EMP-002"));
    expect(body.indexOf("EMP-002")).toBeLessThan(body.indexOf("EMP-003"));
    expect(body.indexOf("EMP-003")).toBeLessThan(body.indexOf("EMP-004"));
  });

  test("a row nobody has recorded is marked Unrecorded", () => {
    const html = render();
    const row = tbody(html).split("</tr>").find((r) => r.includes("EMP-001"))!;

    expect(text(row)).toContain("Unrecorded");
  });

  test("a recorded row shows its status and the shift and area worked", () => {
    const html = render();
    const row = tbody(html).split("</tr>").find((r) => r.includes("EMP-002"))!;

    expect(text(row)).toContain("Present");
    expect(text(row)).toContain("Early");
    expect(text(row)).toContain("Kitchen");
    expect(text(row)).not.toContain("Unrecorded");
    expect(text(row)).not.toContain("Shift differs");
  });

  test("a swapped row shows a Shift differs badge with the rostered shift", () => {
    const html = render();
    const row = tbody(html).split("</tr>").find((r) => r.includes("EMP-003"))!;

    expect(text(row)).toContain("Sick");
    expect(text(row)).toContain("Late");
    expect(text(row)).toContain("Shift differs");
    expect(text(row)).toContain("Rostered: Early");
  });

  test("an unscheduled row shows an Unscheduled badge and its reason", () => {
    const html = render();
    const row = tbody(html).split("</tr>").find((r) => r.includes("EMP-004"))!;

    expect(text(row)).toContain("Unscheduled");
    expect(text(row)).toContain("Absent");
    expect(text(row)).toContain("Covering the late shift");
  });

  test("a soft-deleted worker's recorded row still renders its name", () => {
    // The loader keeps deleted workers, shifts and areas in the maps; the view
    // only ever looks labels up, so a deleted shift still has its label.
    const html = render({
      data: dayData({
        roster: [],
        records: [
          {
            id: "r9",
            workerId: "w9",
            shiftDefId: "shift-gone",
            workAreaId: "area-gone",
            status: "present",
            withoutRoster: false,
            rosteredShiftDefId: "shift-gone",
            reason: null,
          },
        ],
        workers: { w9: { employeeId: "EMP-009", name: "Rina Marlina" } },
        shifts: [
          { id: "shift-gone", label: "Night (retired)", startTime: "22:00", endTime: "06:00", selectable: false },
        ],
        areas: [{ id: "area-gone", name: "Cold room", selectable: false }],
      }),
    });

    expect(text(tbody(html))).toContain("EMP-009");
    expect(text(tbody(html))).toContain("Rina Marlina");
    expect(text(tbody(html))).toContain("Night (retired)");
    expect(text(tbody(html))).toContain("Cold room");
  });
});

describe("AttendanceDayView summary", () => {
  test("shows the five counts", () => {
    const html = render();

    expect(summaryCount(html, "Unrecorded")).toBe("1");
    expect(summaryCount(html, "Present")).toBe("1");
    expect(summaryCount(html, "Sick")).toBe("1");
    expect(summaryCount(html, "Leave")).toBe("0");
    expect(summaryCount(html, "Absent")).toBe("1");
  });
});

describe("AttendanceDayView filters", () => {
  test("a shift filter keeps the rows worked on that shift", () => {
    const body = text(tbody(render({ shiftId: LATE })));

    expect(body).toContain("EMP-003");
    expect(body).toContain("EMP-004");
    expect(body).not.toContain("EMP-001");
    expect(body).not.toContain("EMP-002");
  });

  test("an area filter keeps the rows of that work area", () => {
    const body = text(tbody(render({ areaId: KITCHEN })));

    expect(body).toContain("EMP-001");
    expect(body).toContain("EMP-002");
    expect(body).not.toContain("EMP-003");
  });

  test("the summary counts what the filter leaves", () => {
    const html = render({ areaId: KITCHEN });

    expect(summaryCount(html, "Unrecorded")).toBe("1");
    expect(summaryCount(html, "Present")).toBe("1");
    expect(summaryCount(html, "Sick")).toBe("0");
  });

  test("a filter with no match says so instead of rendering an empty table", () => {
    const html = render({ shiftId: LATE, areaId: KITCHEN });

    expect(text(html)).toContain("No workers match these filters");
    expect(tbody(html)).toBe("");
  });
});

describe("AttendanceDayView empty states", () => {
  test("a day with no roster and no records says there is nobody to record", () => {
    const html = render({
      data: dayData({ roster: [], records: [], workers: {} }),
    });

    expect(text(html)).toContain("Nobody is on the roster for this date");
    expect(tbody(html)).toBe("");
  });
});

describe("AttendanceDayView read-only", () => {
  test("with canWrite false no row control is rendered and the view says it is read-only", () => {
    const html = render({ canWrite: false });
    const body = tbody(html);

    expect(body).not.toContain("<button");
    expect(body).not.toContain("<select");
    expect(body).not.toContain('role="combobox"');
    expect(body).not.toContain("<input");
    expect(text(html)).toContain("read-only");
  });

  test("a future date says attendance cannot be recorded yet", () => {
    const html = render({ future: true });

    expect(text(html)).toContain("Attendance cannot be recorded for a future date");
    expect(tbody(html)).not.toContain("<button");
  });
});

describe("AttendanceDayView header", () => {
  test("shows the date and the location's time zone", () => {
    const html = render();

    expect(html).toContain('value="2026-01-07"');
    expect(text(html)).toContain("WITA");
  });

  test("a single location is shown as a label, several as a picker", () => {
    const one = render();
    const many = render({
      locationOptions: [
        { id: "loc-1", label: "Nestle / Cikarang Plant" },
        { id: "loc-2", label: "Nestle / Karawang Plant" },
      ],
      locationId: "loc-1",
    });

    expect(text(one)).toContain("Cikarang Plant");
    expect(one).not.toContain('id="attendance-location"');
    expect(many).toContain('id="attendance-location"');
    expect(text(many)).toContain("Nestle / Cikarang Plant");
  });
});
