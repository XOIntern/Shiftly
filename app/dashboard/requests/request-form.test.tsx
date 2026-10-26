import "dotenv/config";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The form calls the Task 7 server actions on submit; under bun test the
// module is swapped for stubs that record calls (the static-markup renders
// below never fire them, but the swap also keeps the real "use server"
// module — and its DB client — out of this suite).
const createCalls: unknown[] = [];
const updateCalls: unknown[] = [];
mock.module("@/app/dashboard/requests/actions", () => ({
  createRequest: async (input: unknown) => {
    createCalls.push(input);
    return { ok: true } as const;
  },
  updateRequestLines: async (id: string, lines: unknown) => {
    updateCalls.push({ id, lines });
    return { ok: true } as const;
  },
}));

import type {
  MpRequestGridShift,
  MpRequestGridWorkArea,
  MpRequestLineView,
} from "@/types/mp-request";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import { mpRequestCreateSchema } from "@/validation/request-line";

// Loaded after the mock above registers (bun executes module-level
// statements in order for ESM evaluated here).
const {
  RequestForm,
  areasWithoutPositions,
  buildCreateInput,
  collectLines,
  gridDates,
  gridRows,
  inactiveLinePairs,
  normalizeHeadcount,
  quickFillCells,
  fieldErrorsSummary,
  refusalToast,
} = await import("./request-form");

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

  test("a lines.<i> refusal renders under the matching grid row", () => {
    const html = renderToStaticMarkup(
      <RequestForm
        siteLocations={siteLocations}
        sites={sites}
        activeWorkAreas={activeWorkAreas}
        activeShifts={activeShifts}
        type="weekly"
        siteLocationId={LOC_A1}
        defaultWeekStart={MONDAY}
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

  test("weekly create grid: area × shift × position rows and Mon–Sun columns", () => {
    const html = renderForm({
      siteLocationId: LOC_A1,
      defaultWeekStart: MONDAY,
    });

    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(html.includes(`>${day}<`)).toBeTrue();
    }
    expect(html.includes("Work area / shift / position")).toBeTrue();
    expect(html.includes("Zone One / Morning / Operator")).toBeTrue();
    expect(html.includes("Zone Two / Evening / Technician")).toBeTrue();
    // The headcount cells' accessible names cover the position too (#137).
    expect(
      html.includes(
        `aria-label="Headcount Zone One / Morning / Operator / ${MONDAY}"`,
      ),
    ).toBeTrue();
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

  test("daily variant: no day columns, one headcount column", () => {
    const html = renderForm({
      type: "daily",
      siteLocationId: LOC_A1,
      defaultRequestDate: "2026-01-07",
    });

    expect(html.includes("Headcount")).toBeTrue();
    expect(html.includes(">Mon<")).toBeFalse();
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
          status: "submitted",
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
          status: "submitted",
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
          status: "submitted",
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
});
