import { describe, expect, test } from "bun:test";

import type {
  AttendanceStatus,
  RecordInput,
  RosterRowInput,
} from "@/types/attendance";

import { buildDayRows, filterDayRows, summarizeDayRows } from "./attendance-day";

// Pure: the day page's list is the roster rows of the day joined to whatever
// attendance has been recorded, with no I/O. Ids are short strings here.

const roster = (
  workerId: string,
  workAreaId: string,
  shiftDefId: string,
): RosterRowInput => ({ workerId, workAreaId, shiftDefId });

function record(
  workerId: string,
  shiftDefId: string,
  opts: Partial<RecordInput> = {},
): RecordInput {
  return {
    id: `rec-${workerId}`,
    workerId,
    shiftDefId,
    workAreaId: "areaA",
    status: "present" as AttendanceStatus,
    withoutRoster: false,
    rosteredShiftDefId: shiftDefId,
    reason: null,
    ...opts,
  };
}

describe("buildDayRows", () => {
  test("unrecorded when no record", () => {
    const rows = buildDayRows([roster("w1", "areaA", "s1")], []);

    expect(rows).toHaveLength(1);
    expect(rows[0].workerId).toBe("w1");
    expect(rows[0].state).toBe("unrecorded");
    expect(rows[0].record).toBeNull();
    expect(rows[0].rosterShiftDefId).toBe("s1");
    expect(rows[0].rosterWorkAreaId).toBe("areaA");
    expect(rows[0].shiftDiffers).toBe(false);
  });

  test("recorded with the same shift is not flagged", () => {
    const rows = buildDayRows(
      [roster("w1", "areaA", "s1")],
      [record("w1", "s1")],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("recorded");
    expect(rows[0].shiftDiffers).toBe(false);
    expect(rows[0].record?.status).toBe("present");
  });

  test("swap is flagged", () => {
    const rows = buildDayRows(
      [roster("w1", "areaA", "s1")],
      [record("w1", "s2", { rosteredShiftDefId: "s1" })],
    );

    expect(rows[0].state).toBe("recorded");
    expect(rows[0].shiftDiffers).toBe(true);
    expect(rows[0].rosterShiftDefId).toBe("s1");
  });

  test("without_roster record is unscheduled", () => {
    const rows = buildDayRows(
      [],
      [
        record("w9", "s1", {
          withoutRoster: true,
          rosteredShiftDefId: null,
          reason: "covering a sick colleague",
        }),
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("unscheduled");
    expect(rows[0].rosterShiftDefId).toBeNull();
    expect(rows[0].rosterWorkAreaId).toBeNull();
    expect(rows[0].shiftDiffers).toBe(false);
    expect(rows[0].record?.reason).toBe("covering a sick colleague");
  });

  describe("roster revised after recording", () => {
    test("a recorded worker who left the roster still gives exactly one row", () => {
      const rows = buildDayRows(
        [],
        [record("w1", "s2", { rosteredShiftDefId: "s1" })],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("recorded");
      // The roster fields come from what the record kept.
      expect(rows[0].rosterShiftDefId).toBe("s1");
      expect(rows[0].rosterWorkAreaId).toBe("areaA");
      expect(rows[0].shiftDiffers).toBe(true);
    });

    test("a recorded worker moved to another shift on the roster still gives one row, judged against the rostered shift kept on the record", () => {
      const rows = buildDayRows(
        [roster("w1", "areaA", "s3")],
        [record("w1", "s1", { rosteredShiftDefId: "s1" })],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("recorded");
      expect(rows[0].rosterShiftDefId).toBe("s1");
      expect(rows[0].shiftDiffers).toBe(false);
    });

    test("an unscheduled record whose worker later appears on the roster still gives exactly one row", () => {
      const rows = buildDayRows(
        [roster("w1", "areaB", "s2")],
        [
          record("w1", "s1", {
            withoutRoster: true,
            rosteredShiftDefId: null,
            workAreaId: "areaA",
          }),
        ],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("unscheduled");
      expect(rows[0].record?.shiftDefId).toBe("s1");
      expect(rows[0].shiftDiffers).toBe(false);
    });
  });

  test("weekly and daily rows for the same worker collapse, the first wins", () => {
    const rows = buildDayRows(
      [roster("w1", "areaA", "s1"), roster("w1", "areaB", "s2")],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].rosterShiftDefId).toBe("s1");
    expect(rows[0].rosterWorkAreaId).toBe("areaA");
  });

  test("rows are ordered by worker id, whatever the input order", () => {
    const rows = buildDayRows(
      [roster("w3", "areaA", "s1"), roster("w1", "areaA", "s1")],
      [record("w2", "s1", { withoutRoster: true, rosteredShiftDefId: null })],
    );

    expect(rows.map((row) => row.workerId)).toEqual(["w1", "w2", "w3"]);
  });

  test("an empty day gives an empty list", () => {
    expect(buildDayRows([], [])).toEqual([]);
  });
});

describe("filterDayRows", () => {
  const rows = buildDayRows(
    [
      roster("w1", "areaA", "s1"),
      roster("w2", "areaB", "s1"),
      roster("w3", "areaA", "s2"),
    ],
    [record("w1", "s2", { rosteredShiftDefId: "s1" })],
  );

  test("no filter keeps every row", () => {
    expect(filterDayRows(rows, {})).toHaveLength(3);
  });

  test("filter uses the effective shift: a swapped row matches the worked shift, not the rostered one", () => {
    const onS2 = filterDayRows(rows, { shiftDefId: "s2" }).map((r) => r.workerId);
    const onS1 = filterDayRows(rows, { shiftDefId: "s1" }).map((r) => r.workerId);

    expect(onS2).toEqual(["w1", "w3"]);
    expect(onS1).toEqual(["w2"]);
  });

  test("filter on the work area uses the recorded area when recorded, the rostered one otherwise", () => {
    const withMoved = buildDayRows(
      [roster("w1", "areaA", "s1"), roster("w2", "areaA", "s1")],
      [record("w1", "s1", { workAreaId: "areaB" })],
    );

    expect(
      filterDayRows(withMoved, { workAreaId: "areaB" }).map((r) => r.workerId),
    ).toEqual(["w1"]);
    expect(
      filterDayRows(withMoved, { workAreaId: "areaA" }).map((r) => r.workerId),
    ).toEqual(["w2"]);
  });

  test("shift and area filters combine", () => {
    expect(
      filterDayRows(rows, { shiftDefId: "s1", workAreaId: "areaB" }).map(
        (r) => r.workerId,
      ),
    ).toEqual(["w2"]);
  });
});

describe("summarizeDayRows", () => {
  test("summary counts: unrecorded counts rows without a record", () => {
    const rows = buildDayRows(
      [
        roster("w1", "areaA", "s1"),
        roster("w2", "areaA", "s1"),
        roster("w3", "areaA", "s1"),
        roster("w4", "areaA", "s1"),
      ],
      [
        record("w1", "s1", { status: "present" }),
        record("w2", "s1", { status: "sick" }),
        record("w3", "s1", { status: "leave" }),
        record("w5", "s1", {
          status: "absent",
          withoutRoster: true,
          rosteredShiftDefId: null,
        }),
      ],
    );

    expect(summarizeDayRows(rows)).toEqual({
      unrecorded: 1,
      present: 1,
      leave: 1,
      sick: 1,
      absent: 1,
    });
  });

  test("an empty list summarizes to zeros", () => {
    expect(summarizeDayRows([])).toEqual({
      unrecorded: 0,
      present: 0,
      leave: 0,
      sick: 0,
      absent: 0,
    });
  });
});
