import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { DayRow } from "@/types/attendance";

// mock.module is process-wide in bun: spread the real module back in so other
// suites that import next/navigation keep its other exports.
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/dashboard/attendance",
  useSearchParams: () => new URLSearchParams(),
}));

const { RemoveUnscheduledForm, UnscheduledForm } = await import(
  "./unscheduled-dialog"
);

// Like the correction dialog, both dialogs have a form body that renders
// without a browser. Which workers, shifts and areas the pickers offer is
// pinned in attendance-commit.test.ts (candidatesFor, selectable).

const text = (html: string): string => html.replace(/<[^>]+>/g, "");

function button(html: string, label: string): string | undefined {
  return [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
    .map((m) => m[0])
    .find((b) => text(b).includes(label));
}

const SHIFTS = [
  { id: "s1", label: "Early", startTime: "06:00", endTime: "14:00", selectable: true },
  { id: "s2", label: "Late", startTime: "14:00", endTime: "22:00", selectable: false },
];
const AREAS = [
  { id: "a1", name: "Kitchen", selectable: true },
  { id: "a2", name: "Old store", selectable: false },
];
const CANDIDATES = [
  { id: "w1", employeeId: "EMP-001", name: "Budi Santoso" },
  { id: "w2", employeeId: "EMP-002", name: "Sari Wulandari" },
];

describe("UnscheduledForm", () => {
  function render(
    overrides: Partial<Parameters<typeof UnscheduledForm>[0]> = {},
  ) {
    return renderToStaticMarkup(
      <UnscheduledForm
        date="2026-01-07"
        candidates={CANDIDATES}
        excludeWorkerIds={[]}
        shifts={SHIFTS}
        areas={AREAS}
        onDone={() => {}}
        {...overrides}
      />,
    );
  }

  test("asks for a worker, a shift, a work area, a status and a reason", () => {
    const html = text(render());

    for (const label of ["Worker", "Shift", "Work area", "Status", "Reason"]) {
      expect(html).toContain(label);
    }
    for (const status of ["Present", "Leave", "Sick", "Absent"]) {
      expect(html).toContain(status);
    }
  });

  test("submit stays disabled until every field is set and the reason is typed", () => {
    const submit = button(render(), "Add unscheduled worker");

    expect(submit).toBeDefined();
    expect(submit).toContain("disabled");
  });

  test("with nobody left to add it says so", () => {
    const html = render({ excludeWorkerIds: ["w1", "w2"] });

    expect(text(html)).toContain("Every active worker of this location is already on the list");
  });

  test("names the date it records for", () => {
    expect(text(render())).toContain("2026-01-07");
  });
});

describe("RemoveUnscheduledForm", () => {
  const row = {
    workerId: "w1",
    state: "unscheduled",
    record: { id: "r1", reason: "Covering" },
  } as unknown as DayRow;

  test("asks for a reason and keeps the button disabled until one is typed", () => {
    const html = renderToStaticMarkup(
      <RemoveUnscheduledForm
        row={row}
        workerLabel="EMP-001 Budi Santoso"
        onDone={() => {}}
      />,
    );

    expect(text(html)).toContain("Reason");
    expect(html).toContain("<textarea");
    expect(text(html)).toContain("EMP-001 Budi Santoso");
    expect(button(html, "Remove row")).toContain("disabled");
  });
});
