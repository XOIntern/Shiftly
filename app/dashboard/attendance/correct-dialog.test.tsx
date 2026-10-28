import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DayRow, ShiftOption } from "@/types/attendance";

// mock.module is process-wide in bun: spread the real module back in so other
// suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/dashboard/attendance",
  useSearchParams: () => new URLSearchParams(),
}));

const { CorrectForm } = await import("./correct-dialog");

// The dialog's body is a form in its own right (CorrectForm), so its markup can
// be rendered without a browser; the Dialog around it only adds the overlay.
// The submit rules themselves are pinned in attendance-commit.test.ts.

const EARLY = "cccccccc-1111-4111-8111-111111111111";
const LATE = "cccccccc-2222-4222-8222-222222222222";
const RETIRED = "cccccccc-3333-4333-8333-333333333333";

const SHIFTS: ShiftOption[] = [
  { id: EARLY, label: "Early", startTime: "06:00", endTime: "14:00", selectable: true },
  { id: LATE, label: "Late", startTime: "14:00", endTime: "22:00", selectable: true },
  { id: RETIRED, label: "Night retired", startTime: "22:00", endTime: "06:00", selectable: false },
];

function row(shiftDefId = EARLY): DayRow {
  return {
    workerId: "aaaaaaaa-1111-4111-8111-111111111111",
    rosterShiftDefId: shiftDefId,
    rosterWorkAreaId: "dddddddd-1111-4111-8111-111111111111",
    state: "recorded",
    shiftDiffers: false,
    record: {
      id: "bbbbbbbb-1111-4111-8111-111111111111",
      workerId: "aaaaaaaa-1111-4111-8111-111111111111",
      shiftDefId,
      workAreaId: "dddddddd-1111-4111-8111-111111111111",
      status: "present",
      withoutRoster: false,
      rosteredShiftDefId: shiftDefId,
      reason: null,
    },
  };
}

const text = (html: string): string => html.replace(/<[^>]+>/g, "");

// The opening tag and label of the first button whose text contains `label`.
function button(html: string, label: string): string | undefined {
  return [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
    .map((m) => m[0])
    .find((b) => text(b).includes(label));
}

function render(overrides: Partial<Parameters<typeof CorrectForm>[0]> = {}) {
  return renderToStaticMarkup(
    <CorrectForm
      row={row()}
      shifts={SHIFTS}
      date="2026-01-07"
      workerLabel="EMP-001 Budi Santoso"
      onDone={() => {}}
      {...overrides}
    />,
  );
}

describe("CorrectForm", () => {
  test("offers the four statuses, a shift, and a required reason", () => {
    const html = render();

    for (const label of ["Present", "Leave", "Sick", "Absent"]) {
      expect(text(html)).toContain(label);
    }
    expect(text(html)).toContain("Shift");
    expect(text(html)).toContain("Reason");
    expect(html).toContain("<textarea");
  });

  test("starts from what is on screen: the current status is selected and the shift shown", () => {
    const html = render();

    expect(button(html, "Present")).toContain('aria-pressed="true"');
    expect(button(html, "Sick")).toContain('aria-pressed="false"');
    expect(text(html)).toContain("Early");
  });

  test("submit stays disabled until something changed and a reason is typed", () => {
    const submit = button(render(), "Save correction");

    expect(submit).toBeDefined();
    expect(submit).toContain("disabled");
  });

  test("a retired shift that is already on the row keeps its label", () => {
    const html = render({ row: row(RETIRED) });

    expect(text(html)).toContain("Night retired");
  });

  test("names the worker and the date it corrects", () => {
    const html = render();

    expect(text(html)).toContain("EMP-001 Budi Santoso");
    expect(text(html)).toContain("2026-01-07");
  });
});
