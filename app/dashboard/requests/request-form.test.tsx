import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  MpRequestGridShift,
  MpRequestGridWorkArea,
  MpRequestLineView,
} from "@/types/mp-request";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import { mpRequestCreateSchema } from "@/validation/request-line";

// The form only calls its server actions on submit or click, which static
// markup never fires, so the real actions module is imported as is.
import {
  RequestForm,
  areasWithoutPositions,
  buildCreateInput,
  collectLines,
  copyEmptyMessage,
  copyWeekValues,
  dayTotals,
  gridDates,
  gridRows,
  inactiveLinePairs,
  groupByArea,
  initialAreaIds,
  normalizeHeadcount,
  pruneValues,
  quickFillCells,
  fieldErrorsSummary,
  refusalToast,
  removeAreaValues,
  shouldResetOnWeekChange,
} from "./request-form";

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-9222-222222222222";
const LOC_A1 = "aaaa1111-1111-4111-8111-111111111111";
const LOC_B1 = "bbbb1111-2222-4222-9222-222222222222";
const WA_A1 = "cccc1111-1111-4111-8111-111111111111";
const WA_A2 = "cccc2222-2222-4222-9222-222222222222";
const SH_A1 = "dddd1111-1111-4111-8111-111111111111";
const SH_A2 = "dddd2222-2222-4222-9222-222222222222";
const POS_A1 = "eeee1111-1111-4111-8111-111111111111";
const POS_A2 = "eeee2222-2222-4222-9222-222222222222";
const MONDAY = "2026-01-05"; // a Monday

const sites: SiteOption[] = [
  { id: SITE_A, name: "Site Alpha" },
  { id: SITE_B, name: "Site Beta" },
];
const siteLocations: SiteLocationOption[] = [
  { id: LOC_A1, name: "Loc Alpha One", siteId: SITE_A },
  { id: LOC_B1, name: "Loc Beta One", siteId: SITE_B },
];
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

describe("gridDates", () => {
  test("weekly derives the 7 Monday-start dates from the chosen Monday", () => {
    expect(gridDates("weekly", MONDAY)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
    ]);
  });

  test("weekly snaps a mid-week pick to that week's Mon–Sun", () => {
    // 2026-01-08 is a Thursday; the grid must render its Monday-start week.
    expect(gridDates("weekly", "2026-01-08")).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
    ]);
  });

  test("daily collapses to the single request date", () => {
    expect(gridDates("daily", "2026-01-07")).toEqual(["2026-01-07"]);
  });

  test("no anchor yet derives nothing", () => {
    expect(gridDates("weekly", null)).toEqual([]);
  });
});

describe("quickFillCells (per-row 'same all days')", () => {
  test("populates every day cell of the row with the same headcount", () => {
    const week = gridDates("weekly", MONDAY);
    const cells = quickFillCells("4", week);

    expect(Object.keys(cells).sort()).toEqual([...week].sort());
    for (const date of week) {
      expect(cells[date]).toBe("4");
    }
  });

  test("the daily quick-fill fills the single cell", () => {
    const cells = quickFillCells("6", gridDates("daily", "2026-01-07"));
    expect(cells).toEqual({ "2026-01-07": "6" });
  });

  test("an empty quick-fill clears the row's cells", () => {
    const cells = quickFillCells("", gridDates("weekly", MONDAY));
    expect(Object.keys(cells)).toHaveLength(7);
    expect(Object.values(cells).every((value) => value === "")).toBeTrue();
  });
});

describe("gridRows (active work areas × shifts × required positions)", () => {
  // Ticket #137: the grid is the work area × shift × required-position
  // cross product; an area with an empty required-position set contributes
  // no rows at all.
  const waTwoPositions: MpRequestGridWorkArea = {
    id: WA_A1,
    name: "Zone One",
    siteLocationId: LOC_A1,
    positions: [
      { id: POS_A1, name: "Operator" },
      { id: POS_A2, name: "Technician" },
    ],
  };
  const waNoPositions: MpRequestGridWorkArea = {
    id: WA_A2,
    name: "Zone Two",
    siteLocationId: LOC_A1,
    positions: [],
  };

  test("1 area (2 positions) × 2 shifts → 4 rows; area with no positions → 0 rows", () => {
    const rows = gridRows([waTwoPositions, waNoPositions], activeShifts, LOC_A1);

    expect(rows).toHaveLength(4);
    expect(
      rows.map((row) => `${row.workAreaId}/${row.shiftDefinitionId}/${row.positionId}`),
    ).toEqual([
      `${WA_A1}/${SH_A1}/${POS_A1}`,
      `${WA_A1}/${SH_A1}/${POS_A2}`,
      `${WA_A1}/${SH_A2}/${POS_A1}`,
      `${WA_A1}/${SH_A2}/${POS_A2}`,
    ]);
  });

  test("other locations' masters never join the grid", () => {
    const rows = gridRows([waTwoPositions, waNoPositions], activeShifts, LOC_B1);
    expect(rows).toHaveLength(0);
  });
});

describe("pruneValues", () => {
  const key = (wa: string, sh: string, pos: string) => `${wa}|${sh}|${pos}`;
  const monday = "2026-01-05";
  const tuesday = "2026-01-06";
  const values = {
    [`${key(WA_A1, SH_A1, POS_A1)}|${monday}`]: "3",
    [`${key(WA_A1, SH_A1, POS_A1)}|${tuesday}`]: "2",
    [`${key(WA_A2, SH_A2, POS_A2)}|${monday}`]: "5",
  };

  test("drops the cells of rows that are not kept", () => {
    expect(pruneValues(values, new Set([key(WA_A2, SH_A2, POS_A2)]))).toEqual({
      [`${key(WA_A2, SH_A2, POS_A2)}|${monday}`]: "5",
    });
    expect(pruneValues(values, new Set())).toEqual({});
  });
});

describe("areasWithoutPositions (the configure hint)", () => {
  test("names the location's areas whose required-position set is empty", () => {
    const areas: MpRequestGridWorkArea[] = [
      {
        id: WA_A1,
        name: "Zone One",
        siteLocationId: LOC_A1,
        positions: [{ id: POS_A1, name: "Operator" }],
      },
      { id: WA_A2, name: "Zone Two", siteLocationId: LOC_A1, positions: [] },
      {
        id: "cccc3333-3333-4333-9333-333333333333",
        name: "Zone Three",
        siteLocationId: LOC_B1,
        positions: [],
      },
    ];

    expect(areasWithoutPositions(areas, LOC_A1)).toEqual(["Zone Two"]);
    expect(areasWithoutPositions(areas, LOC_B1)).toEqual(["Zone Three"]);
    expect(areasWithoutPositions(areas, null)).toEqual([]);
  });
});

describe("collectLines / buildCreateInput (the submit payload)", () => {
  const week = gridDates("weekly", MONDAY);
  const filled: Record<string, string> = {};
  // Zone One × Morning × Operator on Mon and Wed, Zone Two × Evening ×
  // Technician on Mon — headcounts typed into the grid, keyed
  // `${workAreaId}|${shiftDefinitionId}|${positionId}|${date}`.
  filled[`${WA_A1}|${SH_A1}|${POS_A1}|${week[0]}`] = "3";
  filled[`${WA_A1}|${SH_A1}|${POS_A1}|${week[2]}`] = "2";
  filled[`${WA_A2}|${SH_A2}|${POS_A2}|${week[0]}`] = "5";

  test("collectLines derives each line's date from the chosen Monday", () => {
    const lines = collectLines(filled, week);

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.date).sort()).toEqual([
      "2026-01-05",
      "2026-01-05",
      "2026-01-07",
    ]);
    expect(lines.every((line) => week.includes(line.date))).toBeTrue();
  });

  test("collectLines carries the position and sorts wa → shift → position → date", () => {
    const lines = collectLines(filled, week);

    expect(lines).toEqual([
      {
        workAreaId: WA_A1,
        shiftDefinitionId: SH_A1,
        positionId: POS_A1,
        date: "2026-01-05",
        headcount: 3,
      },
      {
        workAreaId: WA_A1,
        shiftDefinitionId: SH_A1,
        positionId: POS_A1,
        date: "2026-01-07",
        headcount: 2,
      },
      {
        workAreaId: WA_A2,
        shiftDefinitionId: SH_A2,
        positionId: POS_A2,
        date: "2026-01-05",
        headcount: 5,
      },
    ]);
  });

  test("buildCreateInput returns a create payload the create schema accepts", () => {
    const built = buildCreateInput({
      type: "weekly",
      weekStart: MONDAY,
      requestDate: null,
      siteLocationId: LOC_A1,
      values: filled,
    });

    expect(built.ok).toBeTrue();
    if (!built.ok) return;
    const parsed = mpRequestCreateSchema.safeParse(built.input);
    expect(parsed.success).toBeTrue();
    // Every line carries its demanded position (epic #135).
    expect(built.input.lines.every((line) => line.positionId)).toBeTrue();
    expect(built.input.lines).toHaveLength(3);
    expect(built.input.weekStart).toBe(MONDAY);
    // The notes field is gone (#133): the built payload carries no key.
    expect("notes" in built.input).toBeFalse();
  });

  test("the submitted weekStart is the snapped Monday of the typed anchor", () => {
    const built = buildCreateInput({
      type: "weekly",
      weekStart: "2026-01-08", // Thursday
      requestDate: null,
      siteLocationId: LOC_A1,
      values: filled,
    });

    expect(built.ok).toBeTrue();
    if (!built.ok) return;
    expect(built.input.weekStart).toBe(MONDAY);
  });

  test("a weekly request without its Monday fails at the week field", () => {
    const built = buildCreateInput({
      type: "weekly",
      weekStart: null,
      requestDate: null,
      siteLocationId: LOC_A1,
      values: filled,
    });

    expect(built.ok).toBeFalse();
    if (built.ok) return;
    expect(built.fieldErrors.weekStart).toBe("Week start is required");
  });

  test("a daily request without its date fails at the date field", () => {
    const built = buildCreateInput({
      type: "daily",
      weekStart: null,
      requestDate: null,
      siteLocationId: LOC_A1,
      values: filled,
    });

    expect(built.ok).toBeFalse();
    if (built.ok) return;
    expect(built.fieldErrors.requestDate).toBe("Request date is required");
  });

  test("an empty grid fails at the lines field", () => {
    const built = buildCreateInput({
      type: "weekly",
      weekStart: MONDAY,
      requestDate: null,
      siteLocationId: LOC_A1,
      values: {},
    });

    expect(built.ok).toBeFalse();
    if (built.ok) return;
    expect(built.fieldErrors.lines).toBe("Fill at least one headcount");
  });

  test("a typed '0' headcount never becomes a line (schema min is 1)", () => {
    const week = gridDates("weekly", MONDAY);
    const lines = collectLines(
      {
        [`${WA_A1}|${SH_A1}|${POS_A1}|${week[0]}`]: "0",
        [`${WA_A1}|${SH_A1}|${POS_A1}|${week[1]}`]: "2",
      },
      week,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.headcount).toBe(2);
    expect(normalizeHeadcount("0")).toBe("");
    expect(normalizeHeadcount("10")).toBe("10");
  });
});

describe("refusal surfacing (toasts + grid errors)", () => {
  test("a fieldErrors-only refusal toasts a summary containing the lines error", () => {
    const text = refusalToast({
      ok: false,
      fieldErrors: {
        lines: "Duplicate work area, shift and date combination",
      },
    });
    expect(text).toContain("lines: Duplicate work area, shift and date combination");
  });

  test("sub-field refusals keep their keyed context in the summary", () => {
    const text = refusalToast({
      ok: false,
      fieldErrors: {
        "lines.2.date": "Line date must fall within the request week",
      },
    });
    expect(text).toContain(
      "lines.2.date: Line date must fall within the request week",
    );
  });

  test("a message refusal toasts the message itself (unchanged behavior)", () => {
    expect(
      refusalToast({ ok: false, message: "Request state changed, reload" }),
    ).toBe("Request state changed, reload");
  });

  test("an ok result toasts nothing", () => {
    expect(refusalToast({ ok: true })).toBeNull();
  });

  test("the client-side empty-grid guard produces the toasted text", () => {
    const built = buildCreateInput({
      type: "weekly",
      weekStart: MONDAY,
      requestDate: null,
      siteLocationId: LOC_A1,
      values: {},
    });
    expect(built.ok).toBeFalse();
    if (built.ok) return;
    // handleSubmit toasts fieldErrorsSummary(built.fieldErrors) — the same
    // string asserted here.
    expect(fieldErrorsSummary(built.fieldErrors)).toContain(
      "Fill at least one headcount",
    );
  });

  test("more than three field errors collapse into a count", () => {
    const text = fieldErrorsSummary({
      a: "1",
      b: "2",
      c: "3",
      d: "4",
    });
    expect(text).toContain("a: 1");
    expect(text).toContain("(+1 more)");
  });

  test("fieldErrors.lines renders next to the grid", () => {
    const html = renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        siteLocationId={LOC_A1}
        defaultWeekStart={MONDAY}
        initialFieldErrors={{ lines: "Duplicate work area, shift and date combination" }}
        onSaved={() => {}}
      />,
    );

    expect(html.includes("Duplicate work area, shift and date combination")).toBeTrue();
  });

  test("fieldErrors.lines stays visible with zero rows, next to the empty-grid hint", () => {
    const html = renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        siteLocationId={LOC_A1}
        // A weekly edit with no stored lines opens on the grid with no area
        // added — the zero-row state, reached without a click.
        request={{
          id: "99999999-8888-8888-8888-888888888888",
          type: "weekly",
          weekStart: MONDAY,
          requestDate: null,
          status: "open",
          lines: [],
        }}
        initialFieldErrors={{ lines: "Fill at least one headcount" }}
        onSaved={() => {}}
      />,
    );

    expect(html.includes("Fill at least one headcount")).toBeTrue();
    expect(html.includes("Add an area to start.")).toBeTrue();
  });

  test("a lines.<i> refusal renders under the matching grid row", () => {
    const html = renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        siteLocationId={LOC_A1}
        request={{
          id: "99999999-4444-4444-4444-444444444444",
          type: "weekly",
          weekStart: MONDAY,
          requestDate: null,
          status: "open",
          lines: [
            {
              workAreaId: WA_A1,
              workAreaName: "Zone One",
              shiftDefinitionId: SH_A1,
              shiftLabel: "Morning",
              positionId: POS_A1,
              positionName: "Operator",
              date: MONDAY,
              headcount: 3,
            },
          ],
        }}
        initialFieldErrors={{
          "lines.0.date": "Line date must fall within the request week",
        }}
        onSaved={() => {}}
      />,
    );

    expect(
      html.includes("Line date must fall within the request week"),
    ).toBeTrue();
  });
});

describe("inactiveLinePairs (edit-grid keep-or-remove UX, Task 7 note)", () => {
  const OLD_WA = "eeeeeeee-1111-1111-1111-111111111111";
  const OLD_SH = "ffffffff-1111-1111-1111-111111111111";
  const OLD_POS = "eeee0000-1111-4111-8111-111111111111";
  const OLD_POS_2 = "eeee0000-2222-4222-9222-222222222222";

  test("lines referencing inactive masters surface as read-only pairs", () => {
    const pairs = inactiveLinePairs(
      [
        {
          workAreaId: OLD_WA,
          workAreaName: "Old Zone",
          shiftDefinitionId: OLD_SH,
          shiftLabel: "Night",
          positionId: OLD_POS,
          positionName: "Old Operator",
          date: "2026-01-05",
          headcount: 2,
        },
        {
          workAreaId: WA_A1,
          workAreaName: "Zone One",
          shiftDefinitionId: SH_A1,
          shiftLabel: "Morning",
          positionId: POS_A1,
          positionName: "Operator",
          date: "2026-01-05",
          headcount: 3,
        },
      ],
      activeWorkAreas,
      activeShifts,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.workAreaName).toBe("Old Zone");
    expect(pairs[0]!.shiftLabel).toBe("Night");
    expect(pairs[0]!.positionName).toBe("Old Operator");
  });

  test("pairs group by the wa|shift|position triple, positions apart stay apart", () => {
    const pairs = inactiveLinePairs(
      [
        {
          workAreaId: OLD_WA,
          workAreaName: "Old Zone",
          shiftDefinitionId: OLD_SH,
          shiftLabel: "Night",
          positionId: OLD_POS,
          positionName: "Old Operator",
          date: "2026-01-05",
          headcount: 2,
        },
        {
          workAreaId: OLD_WA,
          workAreaName: "Old Zone",
          shiftDefinitionId: OLD_SH,
          shiftLabel: "Night",
          positionId: OLD_POS,
          positionName: "Old Operator",
          date: "2026-01-06",
          headcount: 1,
        },
        {
          workAreaId: OLD_WA,
          workAreaName: "Old Zone",
          shiftDefinitionId: OLD_SH,
          shiftLabel: "Night",
          positionId: OLD_POS_2,
          positionName: "Technician",
          date: "2026-01-06",
          headcount: 4,
        },
      ],
      activeWorkAreas,
      activeShifts,
    );

    expect(pairs).toHaveLength(2);
    expect(pairs[0]!.positionName).toBe("Old Operator");
    expect(pairs[0]!.dates).toEqual(["2026-01-05", "2026-01-06"]);
    expect(pairs[1]!.positionName).toBe("Technician");
  });

  test("a since-deactivated position on an active pair is inactive too", () => {
    const pairs = inactiveLinePairs(
      [
        {
          workAreaId: WA_A1,
          workAreaName: "Zone One",
          shiftDefinitionId: SH_A1,
          shiftLabel: "Morning",
          positionId: OLD_POS_2,
          positionName: "Retired Role",
          date: "2026-01-05",
          headcount: 2,
        },
      ],
      activeWorkAreas,
      activeShifts,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.positionName).toBe("Retired Role");
  });
});

// Static-markup suite: the dialog composes everything from the props the
// page threads in; interactions (typing, quick-fill clicks) live in the
// pure helpers above because bun test has no DOM.
describe("RequestForm markup", () => {
  function renderForm(props: Partial<
    Parameters<typeof RequestForm>[0]
  > = {}) {
    return renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        onSaved={() => {}}
        {...props}
      />,
    );
  }

  // The stored lines the edit-variant assertions share: Zone One / Morning /
  // Operator on Mon + Wed, Zone Two / Evening / Technician on Mon.
  const storedLines: MpRequestLineView[] = [
    {
      workAreaId: WA_A1,
      workAreaName: "Zone One",
      shiftDefinitionId: SH_A1,
      shiftLabel: "Morning",
      positionId: POS_A1,
      positionName: "Operator",
      date: "2026-01-05",
      headcount: 3,
    },
    {
      workAreaId: WA_A1,
      workAreaName: "Zone One",
      shiftDefinitionId: SH_A1,
      shiftLabel: "Morning",
      positionId: POS_A1,
      positionName: "Operator",
      date: "2026-01-07",
      headcount: 2,
    },
    {
      workAreaId: WA_A2,
      workAreaName: "Zone Two",
      shiftDefinitionId: SH_A2,
      shiftLabel: "Evening",
      positionId: POS_A2,
      positionName: "Technician",
      date: "2026-01-05",
      headcount: 5,
    },
  ];

  function renderEdit(
    type: "weekly" | "daily",
    lines: MpRequestLineView[],
  ) {
    return renderForm({
      type,
      siteLocationId: LOC_A1,
      request: {
        id: "99999999-5555-5555-5555-555555555555",
        type,
        weekStart: type === "weekly" ? MONDAY : null,
        requestDate: type === "daily" ? "2026-01-05" : null,
        status: "open",
        lines,
      },
    });
  }

  test("a location without areas or shifts keeps its message and shows no Add area", () => {
    const html = renderForm({
      siteLocationId: LOC_A1,
      defaultWeekStart: MONDAY,
      activeWorkAreas: [],
      activeShifts: [],
    });

    expect(
      html.includes("This location has no active work areas or shifts yet."),
    ).toBeTrue();
    expect(html.includes(">Add area<")).toBeFalse();
    expect(html.includes("Start blank")).toBeFalse();
  });

  test("weekly edit grid: Mon–Sun columns, every catalog row of the stored areas, a remove-area control", () => {
    const html = renderEdit("weekly", storedLines);

    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(html.includes(`>${day}<`)).toBeTrue();
    }
    // The headcount cells' accessible names cover area, shift, position
    // and date (#137).
    expect(
      html.includes(
        `aria-label="Headcount Zone One / Morning / Operator / ${MONDAY}"`,
      ),
    ).toBeTrue();
    expect(
      html.includes(
        `aria-label="Headcount Zone Two / Evening / Technician / ${MONDAY}"`,
      ),
    ).toBeTrue();
    expect(html.includes('aria-label="Remove area Zone One"')).toBeTrue();
    expect(html.includes('aria-label="Remove area Zone Two"')).toBeTrue();
  });

  test("an area without required positions renders the configure hint", () => {
    const html = renderForm({
      siteLocationId: LOC_A1,
      defaultWeekStart: MONDAY,
      activeWorkAreas: [
        { id: WA_A2, name: "Zone Two", siteLocationId: LOC_A1, positions: [] },
      ],
    });

    // SSR escapes the hint's apostrophe (&#x27;); normalize so the pin
    // reads as the copy users see.
    const text = html.replace(/&#x27;/g, "'");
    expect(text.includes("No required positions: Zone Two")).toBeTrue();
    expect(
      text.includes("configure the area's positions to request for it."),
    ).toBeTrue();
    expect(
      html.includes("This location has no active work areas or shifts yet."),
    ).toBeFalse();
  });

  test("daily edit keeps the single headcount column and no day columns", () => {
    const html = renderEdit(
      "daily",
      storedLines.filter((line) => line.date === "2026-01-05"),
    );

    expect(html.includes(">Headcount<")).toBeTrue();
    expect(html.includes(">Mon<")).toBeFalse();
    expect(html.includes("Zone One / Morning / Operator")).toBeTrue();
  });

  test("edit variant pre-fills the grid from the stored lines and freezes the anchor", () => {
    const lines: MpRequestLineView[] = [
      {
        workAreaId: WA_A1,
        workAreaName: "Zone One",
        shiftDefinitionId: SH_A1,
        shiftLabel: "Morning",
        positionId: POS_A1,
        positionName: "Operator",
        date: "2026-01-05",
        headcount: 3,
      },
      {
        workAreaId: WA_A1,
        workAreaName: "Zone One",
        shiftDefinitionId: SH_A1,
        shiftLabel: "Morning",
        positionId: POS_A1,
        positionName: "Operator",
        date: "2026-01-07",
        headcount: 2,
      },
    ];
    const html = renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        siteLocationId={LOC_A1}
        request={{
          id: "99999999-1111-1111-1111-111111111111",
          type: "weekly",
          weekStart: MONDAY,
          requestDate: null,
          status: "open",
          lines,
        }}
        onSaved={() => {}}
      />,
    );

    expect(html.includes('value="3"')).toBeTrue();
    expect(html.includes('value="2"')).toBeTrue();
    expect(html.includes("disabled")).toBeTrue(); // anchor input frozen
  });

  test("inactive-referencing lines render as read-only rows with a hint", () => {    const html = renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        siteLocationId={LOC_A1}
        request={{
          id: "99999999-2222-2222-2222-222222222222",
          type: "weekly",
          weekStart: MONDAY,
          requestDate: null,
          status: "open",
          lines: [
            {
              workAreaId: "eeeeeeee-1111-1111-1111-111111111111",
              workAreaName: "Old Zone",
              shiftDefinitionId: "ffffffff-1111-1111-1111-111111111111",
              shiftLabel: "Night",
              positionId: "eeeeeeee-2222-2222-2222-222222222222",
              positionName: "Old Operator",
              date: "2026-01-05",
              headcount: 7,
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );

    expect(html.includes("Old Zone / Night / Old Operator")).toBeTrue();
    expect(html.includes("Inactive — keep unchanged or remove")).toBeTrue();
    expect(html.includes(">7</td>")).toBeTrue();
    expect(html.includes("Remove inactive line")).toBeTrue();
  });

  test("daily edit grid shows the remove control for an inactive-referencing row", () => {
    const html = renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="daily"
        siteLocationId={LOC_A1}
        request={{
          id: "99999999-3333-3333-3333-333333333333",
          type: "daily",
          weekStart: null,
          requestDate: "2026-01-07",
          status: "open",
          lines: [
            {
              workAreaId: "eeeeeeee-1111-1111-1111-111111111111",
              workAreaName: "Old Zone",
              shiftDefinitionId: "ffffffff-1111-1111-1111-111111111111",
              shiftLabel: "Night",
              positionId: "eeeeeeee-2222-2222-2222-222222222222",
              positionName: "Old Operator",
              date: "2026-01-07",
              headcount: 5,
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );

    expect(html.includes("Old Zone / Night / Old Operator")).toBeTrue();
    expect(html.includes("Inactive — keep unchanged or remove")).toBeTrue();
    expect(html.includes("Remove inactive line")).toBeTrue();
  });

  test("a removed inactive pair's headcounts drop out of the daily submit", () => {
    // removePair deletes the pair's date keys from the values map; the
    // submit payload built from the post-removal map carries no such line.
    const built = buildCreateInput({
      type: "daily",
      weekStart: null,
      requestDate: "2026-01-07",
      siteLocationId: LOC_A1,
      values: {
        // Only an active pair's cell remains — the inactive pair was removed.
        [`${WA_A1}|${SH_A1}|${POS_A1}|2026-01-07`]: "3",
      },
    });

    expect(built.ok).toBeTrue();
    if (!built.ok) return;
    expect(built.input.lines).toEqual([
      {
        workAreaId: WA_A1,
        shiftDefinitionId: SH_A1,
        positionId: POS_A1,
        date: "2026-01-07",
        headcount: 3,
      },
    ]);
  });

  test("superadmin picks site → location; an admin's location is pinned", () => {
    const superHtml = renderForm({});
    expect(superHtml.includes("Select a site")).toBeTrue();

    const pinnedHtml = renderForm({
      siteLocations: [siteLocations[0]!],
      pinnedLocationName: "Loc Alpha One",
    });
    expect(pinnedHtml.includes("Select a site")).toBeFalse();
    expect(pinnedHtml.includes("Loc Alpha One")).toBeTrue();
  });

  test("the removed notes field renders nowhere in the form (#133)", () => {
    const html = renderForm({
      siteLocationId: LOC_A1,
      defaultWeekStart: MONDAY,
    });

    expect(html.includes('id="request-notes"')).toBeFalse();
    expect(html.includes(">Notes<")).toBeFalse();
  });

  test("a seeded fieldError renders next to the week input", () => {
    const html = renderForm({
      siteLocationId: LOC_A1,
      initialFieldErrors: { weekStart: "Week start must be a Monday" },
    });

    expect(html.includes("Week start must be a Monday")).toBeTrue();
    expect(html.includes('id="request-week-start"')).toBeTrue();
  });

  // The element carrying the id, so the assertions read that one tag and not
  // whatever else the markup holds.
  const tagWithId = (html: string, id: string) =>
    html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] ?? "";

  test("weekly create picks the week through a calendar trigger, not a native date input", () => {
    const html = renderForm({
      siteLocationId: LOC_A1,
      defaultWeekStart: MONDAY,
    });
    const trigger = tagWithId(html, "request-week-start");

    expect(trigger).not.toBe("");
    expect(trigger.includes('type="date"')).toBeFalse();
    expect(trigger.includes(' disabled=""')).toBeFalse();
    // The trigger shows the chosen week's Monday.
    expect(html.includes("5 Jan 2026")).toBeTrue();
  });

  test("weekly create with no week chosen invites a pick", () => {
    const html = renderForm({ siteLocationId: LOC_A1 });

    // The trigger's own text, not the grid's "Pick a week to open…" hint.
    expect(html.includes(">Pick a week<")).toBeTrue();
  });

  test("a non-Monday week start shows the Monday it resolves to", () => {
    const html = renderForm({
      siteLocationId: LOC_A1,
      defaultWeekStart: "2026-01-08",
    });

    expect(html.includes("5 Jan 2026")).toBeTrue();
    expect(html.includes("8 Jan 2026")).toBeFalse();
  });

  test("weekly edit keeps the week field disabled", () => {
    const html = renderEdit("weekly", storedLines);
    const trigger = tagWithId(html, "request-week-start");

    expect(trigger.includes(' disabled=""')).toBeTrue();
    expect(trigger.includes('type="date"')).toBeFalse();
    expect(html.includes("5 Jan 2026")).toBeTrue();
  });

  test("daily create picks the date through a calendar trigger, not a native date input", () => {
    const html = renderForm({ type: "daily", siteLocationId: LOC_A1 });
    const trigger = tagWithId(html, "request-request-date");

    expect(trigger).not.toBe("");
    expect(trigger.includes('type="date"')).toBeFalse();
    expect(trigger.includes(' disabled=""')).toBeFalse();
    expect(html.includes(">Pick a date<")).toBeTrue();
    expect(html.includes('id="request-week-start"')).toBeFalse();
  });

  test("daily edit keeps the date field disabled and shows the stored date", () => {
    const html = renderEdit("daily", storedLines);
    const trigger = tagWithId(html, "request-request-date");

    expect(trigger.includes(' disabled=""')).toBeTrue();
    expect(trigger.includes('type="date"')).toBeFalse();
    expect(html.includes("5 Jan 2026")).toBeTrue();
  });
});

// The grouped form. Static markup only (bun test has no DOM), so the
// post-choice states are reached through the edit variant's real initial
// state (its areas and values come from the stored lines); the pieces' own
// markup is pinned by their direct render tests (copy-step, area-section,
// totals-row).
describe("grouped form markup", () => {
  const areaNoPositions: MpRequestGridWorkArea = {
    id: "cccc3333-3333-4333-9333-333333333333",
    name: "Zone Three",
    siteLocationId: LOC_A1,
    positions: [],
  };

  // A disabled <button> whose content (icon markup included) holds `label`.
  const disabledButton = (label: string) =>
    new RegExp(`<button[^>]*disabled=""[^>]*>(?:(?!</button>)[\\s\\S])*${label}`);

  function render(props: Partial<Parameters<typeof RequestForm>[0]> = {}) {
    return renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        siteLocationId={LOC_A1}
        onSaved={() => {}}
        {...props}
      />,
    );
  }

  // A weekly edit of the given stored lines: it opens on the grid with the
  // lines' areas added and their headcounts filled.
  function renderWeeklyEdit(
    lines: MpRequestLineView[],
    props: Partial<Parameters<typeof RequestForm>[0]> = {},
  ) {
    return render({
      request: {
        id: "99999999-6666-6666-6666-666666666666",
        type: "weekly",
        weekStart: MONDAY,
        requestDate: null,
        status: "open",
        lines,
      },
      ...props,
    });
  }

  const zoneOneLine = (
    shiftDefinitionId: string,
    shiftLabel: string,
    date: string,
    headcount: number,
  ): MpRequestLineView => ({
    workAreaId: WA_A1,
    workAreaName: "Zone One",
    shiftDefinitionId,
    shiftLabel,
    positionId: POS_A1,
    positionName: "Operator",
    date,
    headcount,
  });

  test("create weekly shows the Copy and Start blank choices before the grid", () => {
    // The real initial state: the copy lookup has not answered yet.
    const html = render({ defaultWeekStart: MONDAY });

    expect(html.includes("How do you want to start this week?")).toBeTrue();
    expect(html.includes("Start blank")).toBeTrue();
    // The grid waits for the choice: no sections, no Add area, no inputs.
    expect(html.includes(">Add area<")).toBeFalse();
    expect(html.includes("Headcount Zone One")).toBeFalse();
    expect(html.includes("<section")).toBeFalse();
    // "Copy from week of <source>" with an enabled button is pinned on
    // CopyStep directly (copy-step.test.tsx), with a resolved source.
  });

  test("copy button is disabled while the lookup is pending", () => {
    // The no-source explanation ("No earlier request to copy for this
    // location.") is pinned on CopyStep directly (copy-step.test.tsx).
    // Before the lookup resolves, the reason is the lookup itself.
    const pending = render({ defaultWeekStart: MONDAY });
    expect(disabledButton("Copy from").test(pending)).toBeTrue();
    expect(pending.includes("Looking for the last request")).toBeTrue();
  });

  test('with no area added the grid shows "Add area" and no area sections', () => {
    // Weekly create after Start blank and a weekly edit with no stored
    // lines render the same grid branch: no areas, every area offered.
    const html = renderWeeklyEdit([]);

    expect(html.includes(">Add area<")).toBeTrue();
    expect(html.includes('aria-label="Add Zone One"')).toBeTrue();
    expect(html.includes('aria-label="Add Zone Two"')).toBeTrue();
    expect(html.includes("<section")).toBeFalse();
    expect(html.includes("Headcount Zone One")).toBeFalse();
    expect(html.includes("Start blank")).toBeFalse();
  });

  test("an added area renders its section with every shift × required position row and the per-day total in the header", () => {
    const html = renderWeeklyEdit([
      zoneOneLine(SH_A1, "Morning", "2026-01-05", 3),
      zoneOneLine(SH_A2, "Evening", "2026-01-05", 2),
      zoneOneLine(SH_A1, "Morning", "2026-01-07", 4),
    ]);

    expect(html.includes("<section")).toBeTrue();
    // Both shifts × Zone One's one required position, on every day.
    for (const shift of ["Morning", "Evening"]) {
      for (const date of gridDates("weekly", MONDAY)) {
        expect(
          html.includes(`aria-label="Headcount Zone One / ${shift} / Operator / ${date}"`),
        ).toBeTrue();
      }
    }
    // The other area is not added: no rows, but it is still offered.
    expect(html.includes("Headcount Zone Two")).toBeFalse();
    expect(html.includes('aria-label="Add Zone Two"')).toBeTrue();
    expect(html.includes('aria-label="Add Zone One"')).toBeFalse();
    // Header: name, per-day totals and the week total.
    expect(html.includes(">Zone One<")).toBeTrue();
    expect(html.includes(">Mon 5<")).toBeTrue();
    expect(html.includes(">Tue 0<")).toBeTrue();
    expect(html.includes(">Wed 4<")).toBeTrue();
    expect(html.includes(">Week 9<")).toBeTrue();
    // The disclosure is a real button that reports its state.
    expect(/<button[^>]*aria-expanded="true"/.test(html)).toBeTrue();
    // The totals row sums every visible row per day and for the week.
    expect(/>Total<[\s\S]*>5<[\s\S]*>9</.test(html)).toBeTrue();
  });

  test("Add area does not offer areas without a required position and shows the existing hint for them", () => {
    const html = renderWeeklyEdit([], {
      activeWorkAreas: [...activeWorkAreas, areaNoPositions],
    });

    expect(html.includes('aria-label="Add Zone One"')).toBeTrue();
    expect(html.includes("Add Zone Three")).toBeFalse();
    const text = html.replace(/&#x27;/g, "'");
    expect(text.includes("No required positions: Zone Three")).toBeTrue();
  });

  test("daily create has no copy step and a single date column", () => {
    // A daily request with a Zone One line opens with that area added (the
    // edit variant's real initial state); AreaSection's daily markup is
    // also pinned directly (area-section.test.tsx).
    const html = render({
      type: "daily",
      request: {
        id: "99999999-9999-9999-9999-999999999999",
        type: "daily",
        weekStart: null,
        requestDate: "2026-01-07",
        status: "open",
        lines: [zoneOneLine(SH_A1, "Morning", "2026-01-07", 6)],
      },
    });

    expect(html.includes("Start blank")).toBeFalse();
    expect(html.includes("Copy from")).toBeFalse();
    expect(html.includes(">Headcount<")).toBeTrue();
    expect(html.includes(">Mon<")).toBeFalse();
    expect(html.includes("Same all days")).toBeFalse();
    expect(
      html.includes('aria-label="Headcount Zone One / Morning / Operator / 2026-01-07"'),
    ).toBeTrue();
    expect(html.includes("2026-01-08")).toBeFalse();
    // A fresh daily create opens on Add area with every positioned area.
    const fresh = render({ type: "daily", defaultRequestDate: "2026-01-07" });
    expect(fresh.includes(">Add area<")).toBeTrue();
    expect(fresh.includes("Start blank")).toBeFalse();
    expect(fresh.includes("Copy from")).toBeFalse();
  });

  test("edit opens with the stored lines' areas already added and no copy step", () => {
    const html = render({
      request: {
        id: "99999999-6666-6666-6666-666666666666",
        type: "weekly",
        weekStart: MONDAY,
        requestDate: null,
        status: "open",
        lines: [
          {
            workAreaId: WA_A2,
            workAreaName: "Zone Two",
            shiftDefinitionId: SH_A2,
            shiftLabel: "Evening",
            positionId: POS_A2,
            positionName: "Technician",
            date: MONDAY,
            headcount: 5,
          },
        ],
      },
    });

    expect(html.includes("Start blank")).toBeFalse();
    expect(html.includes("Copy from")).toBeFalse();
    expect(
      html.includes(`aria-label="Headcount Zone Two / Morning / Technician / ${MONDAY}"`),
    ).toBeTrue();
    expect(html.includes('value="5"')).toBeTrue();
    expect(html.includes("Headcount Zone One")).toBeFalse();
    expect(html.includes('aria-label="Add Zone One"')).toBeTrue();
  });

  test("no Add bar (shift/position pickers) renders", () => {
    for (const html of [
      render({ defaultWeekStart: MONDAY }),
      renderWeeklyEdit([zoneOneLine(SH_A1, "Morning", MONDAY, 3)]),
      render({ type: "daily", defaultRequestDate: "2026-01-07" }),
      render({
        request: {
          id: "99999999-7777-7777-7777-777777777777",
          type: "weekly",
          weekStart: MONDAY,
          requestDate: null,
          status: "open",
          lines: [],
        },
      }),
    ]) {
      expect(html.includes('id="request-add-work-area"')).toBeFalse();
      expect(html.includes('id="request-add-shifts"')).toBeFalse();
      expect(html.includes('id="request-add-positions"')).toBeFalse();
      expect(html.includes("Add rows")).toBeFalse();
      expect(html.includes("Remove row")).toBeFalse();
    }
  });
});

describe("shouldResetOnWeekChange (weekly create week edits)", () => {
  test("another day of the same week changes nothing", () => {
    expect(shouldResetOnWeekChange("2026-01-05", "2026-01-08", "grid", true)).toBeFalse();
  });

  test("a different Monday after the grid step resets to the copy step", () => {
    expect(shouldResetOnWeekChange("2026-01-05", "2026-01-12", "grid", true)).toBeTrue();
    // Clearing the week also leaves the copied/typed dates behind.
    expect(shouldResetOnWeekChange("2026-01-05", "", "grid", true)).toBeTrue();
  });

  test("a different Monday while still on the copy step has nothing to reset", () => {
    expect(shouldResetOnWeekChange("2026-01-05", "2026-01-12", "copy", true)).toBeFalse();
  });

  test("edit and daily forms never reset", () => {
    expect(shouldResetOnWeekChange("2026-01-05", "2026-01-12", "grid", false)).toBeFalse();
  });
});

describe("grouped-by-area form model", () => {
  const areaOne: MpRequestGridWorkArea = {
    id: WA_A1,
    name: "Zone One",
    siteLocationId: LOC_A1,
    positions: [
      { id: POS_A1, name: "Operator" },
      { id: POS_A2, name: "Technician" },
    ],
  };
  const areaTwo: MpRequestGridWorkArea = {
    id: WA_A2,
    name: "Zone Two",
    siteLocationId: LOC_A1,
    positions: [{ id: POS_A2, name: "Technician" }],
  };
  const catalog = gridRows([areaOne, areaTwo], activeShifts, LOC_A1);
  const cell = (wa: string, sh: string, pos: string, date: string) =>
    `${wa}|${sh}|${pos}|${date}`;
  const lineView = (
    wa: string,
    sh: string,
    pos: string,
    date: string,
    headcount: number,
  ): MpRequestLineView => ({
    workAreaId: wa,
    workAreaName: "n",
    shiftDefinitionId: sh,
    shiftLabel: "s",
    positionId: pos,
    positionName: "p",
    date,
    headcount,
  });

  test("groupByArea returns one group per added area in catalog order with all that area's shift×position rows", () => {
    const groups = groupByArea(catalog, new Set([WA_A2, WA_A1]));

    expect(groups.map((g) => [g.workAreaId, g.workAreaName])).toEqual([
      [WA_A1, "Zone One"],
      [WA_A2, "Zone Two"],
    ]);
    expect(groups[0].rows).toEqual(catalog.filter((r) => r.workAreaId === WA_A1));
    expect(groups[0].rows).toHaveLength(4);
    expect(groups[1].rows).toHaveLength(2);
    expect(groupByArea(catalog, new Set([WA_A2])).map((g) => g.workAreaId)).toEqual([WA_A2]);
    expect(groupByArea(catalog, new Set())).toEqual([]);
  });

  test("initialAreaIds derives the areas of stored lines", () => {
    const lines = [
      lineView(WA_A1, SH_A1, POS_A1, "2026-01-05", 2),
      lineView(WA_A1, SH_A2, POS_A2, "2026-01-06", 1),
    ];
    expect([...initialAreaIds(catalog, lines)]).toEqual([WA_A1]);
    // A line whose triple left the catalog contributes no area.
    const stale = [lineView(WA_A2, SH_A1, POS_A1, "2026-01-05", 2)];
    expect(initialAreaIds(catalog, stale).size).toBe(0);
  });

  test("removeAreaValues deletes only that area's cells", () => {
    const values = {
      [cell(WA_A1, SH_A1, POS_A1, "2026-01-05")]: "3",
      [cell(WA_A1, SH_A2, POS_A2, "2026-01-06")]: "1",
      [cell(WA_A2, SH_A1, POS_A2, "2026-01-05")]: "4",
    };
    expect(removeAreaValues(values, WA_A1)).toEqual({
      [cell(WA_A2, SH_A1, POS_A2, "2026-01-05")]: "4",
    });
  });

  test("dayTotals sums headcounts per date and treats blanks as 0", () => {
    const dates = gridDates("weekly", MONDAY);
    const rows = catalog.filter((r) => r.workAreaId === WA_A1);
    const values = {
      [cell(WA_A1, SH_A1, POS_A1, dates[0])]: "3",
      [cell(WA_A1, SH_A2, POS_A2, dates[0])]: "2",
      [cell(WA_A1, SH_A1, POS_A2, dates[1])]: "",
      [cell(WA_A1, SH_A1, POS_A1, dates[2])]: "x",
      // Another area's cell is outside the given rows.
      [cell(WA_A2, SH_A1, POS_A2, dates[0])]: "9",
    };
    expect(dayTotals(values, rows, dates)).toEqual([5, 0, 0, 0, 0, 0, 0]);
  });

  test("copyWeekValues shifts a Monday-anchored week by +7 days and keeps headcounts", () => {
    const lines = [
      lineView(WA_A1, SH_A1, POS_A1, "2025-12-29", 3),
      lineView(WA_A1, SH_A1, POS_A1, "2026-01-04", 2),
      lineView(WA_A2, SH_A2, POS_A2, "2025-12-31", 5),
    ];
    const { values, areaIds } = copyWeekValues(lines, "2025-12-29", "2026-01-05", catalog);

    expect(values).toEqual({
      [cell(WA_A1, SH_A1, POS_A1, "2026-01-05")]: "3",
      [cell(WA_A1, SH_A1, POS_A1, "2026-01-11")]: "2",
      [cell(WA_A2, SH_A2, POS_A2, "2026-01-07")]: "5",
    });
    expect([...areaIds].sort()).toEqual([WA_A1, WA_A2].sort());
  });

  test("copyWeekValues drops lines whose area, shift or position left the catalog (deactivated) and does not add their area", () => {
    const GONE = "ffff1111-1111-4111-8111-111111111111";
    const lines = [
      lineView(WA_A1, SH_A1, POS_A1, "2026-01-05", 3),
      // Position not required by Zone Two in the catalog.
      lineView(WA_A2, SH_A1, POS_A1, "2026-01-05", 4),
      // Shift left the catalog.
      lineView(WA_A1, GONE, POS_A1, "2026-01-06", 2),
      // Area left the catalog.
      lineView(GONE, SH_A1, POS_A1, "2026-01-06", 1),
    ];
    const { values, areaIds } = copyWeekValues(lines, "2026-01-05", "2026-01-12", catalog);

    expect(values).toEqual({
      [cell(WA_A1, SH_A1, POS_A1, "2026-01-12")]: "3",
    });
    expect([...areaIds]).toEqual([WA_A1]);
  });

  test("copyEmptyMessage says nothing could be copied only when no value survived the catalog filter", () => {
    const GONE = "ffff1111-1111-4111-8111-111111111111";
    const dropped = copyWeekValues(
      [lineView(GONE, SH_A1, POS_A1, "2026-01-05", 3)],
      "2026-01-05",
      "2026-01-12",
      catalog,
    );
    expect(copyEmptyMessage(dropped)).toBe(
      "Nothing could be copied: the areas, shifts or positions were deactivated.",
    );
    expect(copyEmptyMessage(copyWeekValues([], "2026-01-05", "2026-01-12", catalog))).toBe(
      "Nothing could be copied: the areas, shifts or positions were deactivated.",
    );

    const kept = copyWeekValues(
      [lineView(WA_A1, SH_A1, POS_A1, "2026-01-05", 3)],
      "2026-01-05",
      "2026-01-12",
      catalog,
    );
    expect(copyEmptyMessage(kept)).toBeNull();
  });
});
