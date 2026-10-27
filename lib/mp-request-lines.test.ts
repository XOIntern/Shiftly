import { describe, expect, test } from "bun:test";

import { mergeRequestLines } from "./mp-request-lines";
import type { MpRequestLineView } from "@/types/mp-request";

const line = (
  over: Partial<MpRequestLineView> & { headcount: number },
): MpRequestLineView => ({
  workAreaId: "wa-1",
  workAreaName: "Bakery",
  shiftDefinitionId: "sh-1",
  shiftLabel: "Shift 1",
  positionId: "pos-1",
  positionName: "Baker",
  date: "2026-02-02",
  ...over,
});

describe("mergeRequestLines", () => {
  test("sums the headcount of lines with the same area, shift, position and date", () => {
    expect(
      mergeRequestLines([line({ headcount: 2 }), line({ headcount: 1 })]),
    ).toEqual([line({ headcount: 3 })]);
  });

  test("keeps lines that differ in any key apart", () => {
    const merged = mergeRequestLines([
      line({ headcount: 1 }),
      line({ headcount: 1, date: "2026-02-03" }),
      line({ headcount: 1, positionId: "pos-2", positionName: "Cashier" }),
      line({ headcount: 1, shiftDefinitionId: "sh-2", shiftLabel: "Shift 2" }),
      line({ headcount: 1, workAreaId: "wa-2", workAreaName: "Checkout" }),
    ]);
    expect(merged).toHaveLength(5);
    expect(merged.every((l) => l.headcount === 1)).toBeTrue();
  });

  test("orders by date, area name, shift label, then position name", () => {
    const merged = mergeRequestLines([
      line({ headcount: 1, date: "2026-02-03" }),
      line({ headcount: 1, positionId: "pos-0", positionName: "Assistant" }),
      line({ headcount: 1, shiftDefinitionId: "sh-2", shiftLabel: "Shift 2" }),
      line({ headcount: 1, workAreaId: "wa-0", workAreaName: "Aisle" }),
      line({ headcount: 1 }),
    ]);
    expect(
      merged.map((l) => [l.date, l.workAreaName, l.shiftLabel, l.positionName]),
    ).toEqual([
      ["2026-02-02", "Aisle", "Shift 1", "Baker"],
      ["2026-02-02", "Bakery", "Shift 1", "Assistant"],
      ["2026-02-02", "Bakery", "Shift 1", "Baker"],
      ["2026-02-02", "Bakery", "Shift 2", "Baker"],
      ["2026-02-03", "Bakery", "Shift 1", "Baker"],
    ]);
  });

  test("the result does not depend on the input order", () => {
    const input = [
      line({ headcount: 2 }),
      line({ headcount: 4, date: "2026-02-04" }),
      line({ headcount: 1, workAreaId: "wa-2", workAreaName: "Checkout" }),
      line({ headcount: 3 }),
    ];
    const expected = mergeRequestLines(input);
    expect(mergeRequestLines([...input].reverse())).toEqual(expected);
    expect(mergeRequestLines([input[2], input[0], input[3], input[1]])).toEqual(expected);
  });

  test("an empty list stays empty", () => {
    expect(mergeRequestLines([])).toEqual([]);
  });
});
