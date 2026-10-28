"use client";

import {
  Fragment,
  useEffect,
  useState,
  useTransition,
  type ComponentProps,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  CopyIcon,
  EraserIcon,
  PaintBucketIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import type {
  MpRequestGridShift,
  MpRequestGridWorkArea,
  MpRequestLineView,
} from "@/types/mp-request";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import { GENERIC_ERROR } from "@/lib/action-state";
import { dayFromNumber, dayNumber } from "@/lib/dates";
import { mondayOf, weekDates } from "@/lib/week";
import {
  createRequest,
  loadCopySource,
  updateRequestLines,
} from "@/app/dashboard/requests/actions";
import type { MpRequestCreateInput } from "@/validation/request-line";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Pure grid primitives (exported for the form tests — bun test has no DOM,
// so the interactions are asserted through these helpers).
// ---------------------------------------------------------------------------

// The headcount input lives in state as a string keyed
// `${workAreaId}|${shiftDefinitionId}|${positionId}|${date}` (#137) — one
// map serves the weekly 7-day grid and the daily single-date grid alike.
export type GridValues = Record<string, string>;

// The dates the grid shows: the 7 Monday-start days, or the single daily
// date. An empty anchor renders no grid at all.
export function gridDates(type: "weekly" | "daily", anchor: string | null) {
  if (!anchor) return [];
  return type === "weekly" ? weekDates(mondayOf(anchor)) : [anchor];
}

export type GridRow = {
  key: string;
  workAreaId: string;
  workAreaName: string;
  shiftDefinitionId: string;
  shiftLabel: string;
  positionId: string;
  positionName: string;
};

// A grid row per active work area × active shift × the area's required
// positions (#137) — the cross product the spec's grid is built on. An
// area with an empty required-position set contributes no rows at all.
// Other locations' masters never enter (the dialog masters arrive scoped
// per role).
export function gridRows(
  activeWorkAreas: MpRequestGridWorkArea[],
  activeShifts: MpRequestGridShift[],
  siteLocationId: string | null,
): GridRow[] {
  if (!siteLocationId) return [];
  const rows: GridRow[] = [];
  for (const workArea of activeWorkAreas) {
    if (workArea.siteLocationId !== siteLocationId) continue;
    for (const shift of activeShifts) {
      if (shift.siteLocationId !== siteLocationId) continue;
      for (const position of workArea.positions) {
        rows.push({
          key: `${workArea.id}|${shift.id}|${position.id}`,
          workAreaId: workArea.id,
          workAreaName: workArea.name,
          shiftDefinitionId: shift.id,
          shiftLabel: shift.label,
          positionId: position.id,
          positionName: position.name,
        });
      }
    }
  }
  return rows;
}

const rowKeyOfCell = (cellKey: string) =>
  cellKey.split("|").slice(0, 3).join("|");

// Keeps only the cells of rows still in the grid, so stale values (another
// location's rows, removed rows) never reach the submit payload.
export function pruneValues(
  values: GridValues,
  keptRowKeys: ReadonlySet<string>,
): GridValues {
  return Object.fromEntries(
    Object.entries(values).filter(([cell]) =>
      keptRowKeys.has(rowKeyOfCell(cell)),
    ),
  );
}

// Names of the location's areas that render no grid rows because no
// required positions are configured on them (#137) — the form hints at
// configuring them instead of leaving silent emptiness.
export function areasWithoutPositions(
  activeWorkAreas: MpRequestGridWorkArea[],
  siteLocationId: string | null,
): string[] {
  if (!siteLocationId) return [];
  return activeWorkAreas
    .filter(
      (workArea) =>
        workArea.siteLocationId === siteLocationId &&
        workArea.positions.length === 0,
    )
    .map((workArea) => workArea.name);
}

// ---------------------------------------------------------------------------
// Grouped-by-area form model: the grid renders one section per added work
// area, each holding all of that area's shift × required-position rows.
// ---------------------------------------------------------------------------

export type AreaGroup = {
  workAreaId: string;
  workAreaName: string;
  rows: GridRow[];
};

// One group per added area, in catalog order (first appearance of the area),
// each with every catalog row of that area.
export function groupByArea(
  catalog: GridRow[],
  areaIds: ReadonlySet<string>,
): AreaGroup[] {
  const groups = new Map<string, AreaGroup>();
  for (const row of catalog) {
    if (!areaIds.has(row.workAreaId)) continue;
    const group = groups.get(row.workAreaId);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(row.workAreaId, {
        workAreaId: row.workAreaId,
        workAreaName: row.workAreaName,
        rows: [row],
      });
    }
  }
  return [...groups.values()];
}

// Edit seeds the sections from the stored lines whose triple is in the
// catalog; an area whose lines all left the catalog is not seeded.
export function initialAreaIds(
  catalog: GridRow[],
  lines: MpRequestLineView[],
): Set<string> {
  const catalogKeys = new Set(catalog.map((row) => row.key));
  const areaIds = new Set<string>();
  for (const line of lines) {
    const key = `${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}`;
    if (catalogKeys.has(key)) areaIds.add(line.workAreaId);
  }
  return areaIds;
}

// Removing an area section deletes its cells, so re-adding it starts blank.
export function removeAreaValues(
  values: GridValues,
  workAreaId: string,
): GridValues {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([cell]) => cell.split("|")[0] !== workAreaId,
    ),
  );
}

// Per-date headcount total across the given rows. Blank, missing and
// non-numeric cells count as 0.
export function dayTotals(
  values: GridValues,
  rows: GridRow[],
  dates: string[],
): number[] {
  return dates.map((date) =>
    rows.reduce((sum, row) => {
      const count = Number(values[`${row.key}|${date}`]);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0),
  );
}

// Copy-from-last-week: re-dates the source lines by the whole-day offset
// between the two Mondays. Lines whose area, shift or position left the
// catalog (deactivated) are dropped, and an area only comes along when one of
// its lines is kept — nothing silently reappears.
export function copyWeekValues(
  lines: MpRequestLineView[],
  fromWeekStart: string,
  toWeekStart: string,
  catalog: GridRow[],
): { values: GridValues; areaIds: Set<string> } {
  const offset = dayNumber(toWeekStart) - dayNumber(fromWeekStart);
  const catalogKeys = new Set(catalog.map((row) => row.key));
  const values: GridValues = {};
  const areaIds = new Set<string>();
  for (const line of lines) {
    const rowKey = `${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}`;
    if (!catalogKeys.has(rowKey)) continue;
    const date = dayFromNumber(dayNumber(line.date) + offset);
    values[`${rowKey}|${date}`] = String(line.headcount);
    areaIds.add(line.workAreaId);
  }
  return { values, areaIds };
}

// Weekly create: once the user has moved past the copy step, a week edit
// that lands on another Monday strands the copied/typed cells on the old
// dates, so the form starts over at the copy step for the new week. Another
// day inside the same week changes nothing; edit and daily never reset.
export function shouldResetOnWeekChange(
  oldWeekStart: string,
  newWeekStart: string,
  step: "copy" | "grid",
  isWeeklyCreate: boolean,
): boolean {
  if (!isWeeklyCreate || step !== "grid") return false;
  const monday = (date: string) => (date ? mondayOf(date) : "");
  return monday(oldWeekStart) !== monday(newWeekStart);
}

// Per-row "same all days": one value spread over the row's day cells. An
// empty spread clears them all.
export function quickFillCells(count: string, dates: string[]) {
  const cells: Record<string, string> = {};
  for (const date of dates) cells[date] = count;
  return cells;
}

// Non-empty cells become lines, each date taken verbatim from the grid's
// derived dates — the action never sees week math. Ordered
// deterministically so a re-submit cannot forge a spurious diff.
export function collectLines(values: GridValues, dates: string[]) {
  const allowed = new Set(dates);
  return Object.entries(values)
    .filter(([, headcount]) => headcount !== "")
    .map(([key, headcount]) => {
      const [workAreaId, shiftDefinitionId, positionId, date] = key.split("|");
      return {
        workAreaId,
        shiftDefinitionId,
        positionId,
        date,
        headcount: Number(headcount),
      };
    })
    .filter((line) => allowed.has(line.date) && line.headcount > 0)
    .sort((a, b) =>
      `${a.workAreaId}${a.shiftDefinitionId}${a.positionId}${a.date}`.localeCompare(
        `${b.workAreaId}${b.shiftDefinitionId}${b.positionId}${b.date}`,
      ),
    );
}

type BuildResult =
  | { ok: true; input: MpRequestCreateInput }
  | { ok: false; fieldErrors: Record<string, string> };

// Shapes the exact create payload the form's submit handler sends to
// createRequest. Edit reuses its `.lines` for updateRequestLines — the
// stored anchor is immutable, so the action re-checks dates against it.
export function buildCreateInput(state: {
  type: "weekly" | "daily";
  weekStart: string | null;
  requestDate: string | null;
  siteLocationId: string | undefined;
  values: GridValues;
}): BuildResult {
  const anchor = state.type === "weekly" ? state.weekStart : state.requestDate;
  const fieldErrors: Record<string, string> = {};
  if (!state.siteLocationId) {
    fieldErrors.siteLocationId = "Location is required";
  }
  if (!anchor) {
    fieldErrors[state.type === "weekly" ? "weekStart" : "requestDate"] =
      state.type === "weekly"
        ? "Week start is required"
        : "Request date is required";
  }
  const lines = collectLines(state.values, gridDates(state.type, anchor));
  if (lines.length === 0) {
    fieldErrors.lines = "Fill at least one headcount";
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const input: MpRequestCreateInput = {
    siteLocationId: state.siteLocationId,
    type: state.type,
    lines,
  };
  if (state.type === "weekly") input.weekStart = mondayOf(state.weekStart!);
  else input.requestDate = state.requestDate!;
  return { ok: true, input };
}

export type InactivePair = {
  workAreaId: string;
  workAreaName: string;
  shiftDefinitionId: string;
  shiftLabel: string;
  positionId: string;
  positionName: string;
  dates: string[];
};

// Lines whose work area / shift pair is missing from the location's active
// masters — or whose demanded position left the area's required set (#137)
// — can only be kept unchanged or removed (re-adding an inactive reference
// is refused by the action). Pairs group by the wa|shift|position triple.
export function inactiveLinePairs(
  lines: MpRequestLineView[],
  activeWorkAreas: MpRequestGridWorkArea[],
  activeShifts: MpRequestGridShift[],
): InactivePair[] {
  const activeWorkAreaIds = new Set(activeWorkAreas.map((row) => row.id));
  const activeShiftIds = new Set(activeShifts.map((row) => row.id));
  // A line is only live when its demanded position is still one of the
  // (active) area's required positions.
  const requiredPositions = new Set(
    activeWorkAreas.flatMap((row) =>
      row.positions.map((position) => `${row.id}|${position.id}`),
    ),
  );

  const pairs: InactivePair[] = [];
  const indexOf = new Map<string, number>();
  for (const line of lines) {
    const stillRequired =
      activeWorkAreaIds.has(line.workAreaId) &&
      activeShiftIds.has(line.shiftDefinitionId) &&
      requiredPositions.has(`${line.workAreaId}|${line.positionId}`);
    if (stillRequired) continue;
    const key = `${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}`;
    const index = indexOf.get(key);
    if (index === undefined) {
      indexOf.set(key, pairs.length);
      pairs.push({
        workAreaId: line.workAreaId,
        workAreaName: line.workAreaName,
        shiftDefinitionId: line.shiftDefinitionId,
        shiftLabel: line.shiftLabel,
        positionId: line.positionId,
        positionName: line.positionName,
        dates: [line.date],
      });
    } else {
      pairs[index]!.dates.push(line.date);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

type FieldErrors = Record<string, string>;

type EditRequest = {
  id: string;
  type: "weekly" | "daily";
  weekStart: string | null;
  requestDate: string | null;
  status: string;
  lines: MpRequestLineView[];
};

type SelectOption = { label: string; value: string | null; disabled?: boolean };

function toSelectItems(
  options: Array<{ id: string; name: string }>,
  placeholder: string,
): SelectOption[] {
  return [
    { label: placeholder, value: null, disabled: true },
    ...options.map((option) => ({ label: option.name, value: option.id })),
  ];
}

// The location options admissible for one site pick: nothing picked keeps
// every option, a picked site narrows to its own locations (same rule as
// the shift dialog).
function siteLocationOptionsFor(
  siteLocations: SiteLocationOption[],
  siteId: string | null,
): SiteLocationOption[] {
  return siteId === null
    ? siteLocations
    : siteLocations.filter((option) => option.siteId === siteId);
}

function SelectField({
  id,
  label,
  items,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  items: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <Field data-invalid={error ? "true" : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem
                key={item.value ?? "placeholder"}
                value={item.value}
                disabled={item.disabled}
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error ? <FieldError errors={[{ message: error }]} /> : null}
    </Field>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Headcounts are typed as digits-only strings capped at the schema's 999.
// A bare "0" normalizes to empty — the line schema's min is 1, so a typed
// zero can only ever produce a doomed submission.
export const normalizeHeadcount = (raw: string) => {
  const digits = raw.replace(/\D/g, "").slice(0, 3);
  return digits === "0" ? "" : digits;
};

// Compact toast text for a fieldErrors-only refusal (no `message`): the
// first few "key: message" pairs, then a count of the rest.
export function fieldErrorsSummary(fieldErrors: Record<string, string>) {
  const entries = Object.entries(fieldErrors);
  if (entries.length === 0) return GENERIC_ERROR;
  const head = entries.slice(0, 3).map(([key, error]) => `${key}: ${error}`);
  return entries.length > 3
    ? `${head.join(" · ")} (+${entries.length - 3} more)`
    : head.join(" · ");
}

// The toast text a failed action result must produce: its `message` when
// one exists, else a summary of its fieldErrors (never silent).
export function refusalToast(result: ActionState): string | null {
  if (result.ok) return null;
  if (result.message) return result.message;
  return fieldErrorsSummary(result.fieldErrors ?? {});
}

type CopySource = { weekStart: string; lines: MpRequestLineView[] };

// The resolved copy lookup, tagged with the location|Monday it answers for:
// a tag that differs from the current one means the lookup is in flight.
type CopyLookup = { key: string; source: CopySource | null };

// Fixed column widths shared by every section table and the totals table,
// so the day columns line up down the whole form.
const NAME_COL = "w-44";
const DAY_COL = "w-16";
const TAIL_COL = "w-32";

const triple = (row: {
  workAreaId: string;
  shiftDefinitionId: string;
  positionId: string;
}) => `${row.workAreaId}|${row.shiftDefinitionId}|${row.positionId}`;

function GridColumns({ dates, tail }: { dates: string[]; tail: boolean }) {
  return (
    <colgroup>
      <col className={NAME_COL} />
      {dates.map((date) => (
        <col key={date} className={DAY_COL} />
      ))}
      {tail ? <col className={TAIL_COL} /> : null}
    </colgroup>
  );
}

function DayHeaders({ type }: { type: "weekly" | "daily" }) {
  return type === "weekly" ? (
    <>
      {DAYS.map((day) => (
        <th key={day} scope="col" className="px-1 py-2 text-center font-medium">
          {day}
        </th>
      ))}
    </>
  ) : (
    <th scope="col" className="px-1 py-2 text-center font-medium">
      Headcount
    </th>
  );
}

// The row label column stays put while the day columns scroll sideways on
// narrow screens.
const STICKY_CELL = "sticky left-0 z-[1] bg-card";

export function RequestForm({
  siteLocations,
  sites,
  pinnedLocationName,
  activeWorkAreas,
  activeShifts,
  type,
  siteLocationId,
  request,
  initialFieldErrors,
  defaultWeekStart,
  defaultRequestDate,
  defaultStep,
  defaultAreaIds,
  defaultValues,
  initialCopySource,
  onSaved,
}: {
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  // An admin actor's pinned location name — their location is pinned
  // server-side, so the create dialog renders no site/location pick at all.
  pinnedLocationName?: string;
  activeWorkAreas: MpRequestGridWorkArea[];
  activeShifts: MpRequestGridShift[];
  // Create dialog's request type; the edit variant freezes to the stored
  // anchor's type via `request`.
  type: "weekly" | "daily";
  // Create: the pinned admin's (or a picked) location seed; edit: the
  // request's own location, immutable.
  siteLocationId?: string;
  request?: EditRequest;
  // Pre-seeded ActionState.fieldErrors (tests; re-opened dialogs).
  initialFieldErrors?: FieldErrors;
  // Pre-filled create state (tests; a re-opened form could restore it). The
  // edit variant ignores them — its anchor and lines come from the request.
  defaultWeekStart?: string;
  defaultRequestDate?: string;
  // "grid" skips the weekly copy step, as if a choice had been made.
  defaultStep?: "copy" | "grid";
  defaultAreaIds?: string[];
  defaultValues?: GridValues;
  // An already-resolved copy lookup for the initial location and week
  // (tests); `null` means "nothing to copy". Omitted, the form looks it up.
  initialCopySource?: CopySource | null;
  onSaved: () => void;
}) {
  const isEdit = !!request;
  const effectiveType = request?.type ?? type;
  const anchor = request
    ? (request.weekStart ?? request.requestDate ?? "")
    : "";

  const [type_, setType_] = useState(effectiveType);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(
    siteLocationId ?? null,
  );
  const [weekStart, setWeekStart] = useState(
    request?.type === "weekly" ? anchor : (defaultWeekStart ?? ""),
  );
  const [requestDate, setRequestDate] = useState(
    request?.type === "daily" ? anchor : (defaultRequestDate ?? ""),
  );
  // Existing lines pre-fill the grid (edit); inactive-pair keys ride the
  // same map so their submitted tuples re-travel byte-identical.
  const [values, setValues] = useState<GridValues>(() =>
    request
      ? Object.fromEntries(
          request.lines.map((line) => [
            `${triple(line)}|${line.date}`,
            String(line.headcount),
          ]),
        )
      : { ...defaultValues },
  );
  const [removedPairs, setRemovedPairs] = useState<Set<string>>(new Set());
  // The added area sections. Edit seeds them from the stored lines (its
  // location is the immutable prop, so the catalog is already known).
  const [areaIds, setAreaIds] = useState<Set<string>>(() =>
    request
      ? initialAreaIds(
          gridRows(activeWorkAreas, activeShifts, siteLocationId ?? null),
          request.lines,
        )
      : new Set(defaultAreaIds),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Weekly create starts on the copy-or-blank choice.
  const [step, setStep] = useState<"copy" | "grid">(defaultStep ?? "copy");
  const [quickFill, setQuickFill] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(
    initialFieldErrors ?? {},
  );
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Type switch on create resets the anchor of the other kind (a weekly
  // pick with a lingering daily date would collide with the stored CHECK).
  function switchType(next: "weekly" | "daily") {
    setType_(next);
    setFieldErrors({});
    if (next === "weekly") setRequestDate("");
    else setWeekStart("");
  }

  const showLocationSelect = !isEdit && pinnedLocationName === undefined;
  const showSiteSelect = showLocationSelect && sites.length > 1;
  const locationOptions = showSiteSelect
    ? siteLocationOptionsFor(siteLocations, siteId)
    : siteLocations;
  // Create resolve: pinned admins submit their binding, others their pick.
  const effectiveLocationId = isEdit
    ? siteLocationId
    : ((pinnedLocationName !== undefined ? siteLocations[0]?.id : locationId) ??
      undefined);

  const dates = gridDates(type_, type_ === "weekly" ? weekStart : requestDate);
  const catalog = gridRows(
    activeWorkAreas,
    activeShifts,
    effectiveLocationId ?? null,
  );
  const groups = groupByArea(catalog, areaIds);
  const rows = groups.flatMap((group) => group.rows);
  // "Add area" offers the catalog areas not yet added — an area without
  // required positions has no catalog rows, so it is never offered.
  const addableAreas = groupByArea(
    catalog,
    new Set(catalog.map((row) => row.workAreaId)),
  ).filter((group) => !areaIds.has(group.workAreaId));
  // Areas rendering no rows because nothing positions them (#137): hinted
  // above the grid — or in the empty state — instead of silent emptiness.
  const configureHint = (() => {
    const unconfigured = areasWithoutPositions(
      activeWorkAreas,
      effectiveLocationId ?? null,
    );
    return unconfigured.length > 0
      ? `No required positions: ${unconfigured.join(", ")} — configure the area's positions to request for it.`
      : null;
  })();
  const inactivePairs = request
    ? inactiveLinePairs(request.lines, activeWorkAreas, activeShifts).filter(
        (pair) => !removedPairs.has(triple(pair)),
      )
    : [];
  // Inactive pairs still travel on submit, so they count in the totals.
  const totalRows: GridRow[] = [
    ...rows,
    ...inactivePairs.map((pair) => ({ ...pair, key: triple(pair) })),
  ];
  const totals = dayTotals(values, totalRows, dates);
  const weekTotal = totals.reduce((sum, count) => sum + count, 0);

  // Copy-from-last-week lookup: weekly create only, keyed by the resolved
  // location and the chosen week's Monday.
  const copyMonday =
    !isEdit && type_ === "weekly" && weekStart ? mondayOf(weekStart) : null;
  const copyKey =
    copyMonday && effectiveLocationId
      ? `${effectiveLocationId}|${copyMonday}`
      : null;
  const [copyLookup, setCopyLookup] = useState<CopyLookup | null>(() =>
    initialCopySource !== undefined && copyKey
      ? { key: copyKey, source: initialCopySource }
      : null,
  );
  useEffect(() => {
    if (!copyKey || !effectiveLocationId || !copyMonday) return;
    // A response for an older location/week never lands over a newer one.
    let stale = false;
    loadCopySource(effectiveLocationId, copyMonday).then(
      (source) => {
        if (!stale) setCopyLookup({ key: copyKey, source });
      },
      () => {
        if (!stale) setCopyLookup({ key: copyKey, source: null });
      },
    );
    return () => {
      stale = true;
    };
  }, [copyKey, effectiveLocationId, copyMonday]);
  const copyPending = copyLookup?.key !== copyKey;
  const copySource = copyPending ? null : (copyLookup?.source ?? null);
  const showCopyStep =
    !isEdit && type_ === "weekly" && step === "copy" && dates.length > 0;

  function removePair(pair: InactivePair) {
    setValues((prev) => {
      const next = { ...prev };
      for (const date of pair.dates) delete next[`${triple(pair)}|${date}`];
      return next;
    });
    setRemovedPairs((prev) => new Set(prev).add(triple(pair)));
  }

  // The sections belong to one location's catalog: a location move starts
  // the form over, copy step included (stale cells are also pruned on
  // submit).
  function resetToCopyStep() {
    setAreaIds(new Set());
    setValues({});
    setQuickFill({});
    setCollapsed(new Set());
    setStep("copy");
  }

  function changeLocation(next: string | null) {
    if (next !== locationId) resetToCopyStep();
    setLocationId(next);
  }

  // A new week (another Monday) after Copy or Start blank goes back to the
  // copy step, so the offer for the new week is usable again.
  function changeWeekStart(next: string) {
    if (
      shouldResetOnWeekChange(
        weekStart,
        next,
        step,
        !isEdit && type_ === "weekly",
      )
    ) {
      resetToCopyStep();
    }
    setWeekStart(next);
  }

  function copyFromSource() {
    if (!copySource || !copyMonday) return;
    const copied = copyWeekValues(
      copySource.lines,
      copySource.weekStart,
      copyMonday,
      catalog,
    );
    setValues(copied.values);
    setAreaIds(copied.areaIds);
    setStep("grid");
  }

  function addArea(workAreaId: string) {
    setAreaIds((prev) => new Set(prev).add(workAreaId));
  }

  function removeArea(workAreaId: string) {
    setAreaIds((prev) => {
      const next = new Set(prev);
      next.delete(workAreaId);
      return next;
    });
    setValues((prev) => removeAreaValues(prev, workAreaId));
    setQuickFill((prev) => removeAreaValues(prev, workAreaId));
    // Re-adding the area starts it open again.
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(workAreaId);
      return next;
    });
  }

  function toggleArea(workAreaId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(workAreaId)) next.delete(workAreaId);
      else next.add(workAreaId);
      return next;
    });
  }

  function applyQuickFill(row: GridRow) {
    const spread = quickFillCells(quickFill[row.key] ?? "", dates);
    setValues((prev) => {
      const next = { ...prev };
      for (const date of dates) next[`${row.key}|${date}`] = spread[date];
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors({});
    setMessage(undefined);

    // Only the grid's rows travel: the added areas' rows plus the inactive
    // pairs kept unchanged. Removed pairs and stale cells drop out here.
    const liveValues = pruneValues(
      values,
      new Set([
        ...rows.map((row) => row.key),
        ...inactivePairs.map((pair) => triple(pair)),
      ]),
    );

    const built = buildCreateInput({
      type: type_,
      weekStart: weekStart || null,
      requestDate: requestDate || null,
      siteLocationId: effectiveLocationId,
      values: liveValues,
    });
    if (!built.ok) {
      setFieldErrors(built.fieldErrors);
      // The guard must never no-op silently — the same summary text the
      // server refusals get.
      toast.error(fieldErrorsSummary(built.fieldErrors));
      return;
    }

    startTransition(async () => {
      const result: ActionState = isEdit
        ? await updateRequestLines(request.id, built.input.lines)
        : await createRequest(built.input);
      if (result.ok) {
        toast.success(isEdit ? "Request lines updated." : "Request created.");
        onSaved();
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.message) setMessage(result.message);
      const toastText = refusalToast(result);
      if (toastText) toast.error(toastText);
    });
  }

  const weekly = type_ === "weekly";
  // Columns per row: label, the dates, and (weekly) the "same all days" or
  // week-total tail.
  const columnCount = 1 + dates.length + (weekly ? 1 : 0);

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        {message ? <FieldError>{message}</FieldError> : null}

        {isEdit ? null : pinnedLocationName !== undefined ? (
          // Pinned admin: the location rides the session server-side, so
          // the pick renders as a read-only name instead of a select.
          <Field>
            <FieldLabel htmlFor="request-location">Location</FieldLabel>
            <Input id="request-location" value={pinnedLocationName} disabled />
          </Field>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {showSiteSelect ? (
              <SelectField
                id="request-site"
                label="Site"
                items={toSelectItems(sites, "Select a site")}
                value={siteId}
                onChange={(next) => {
                  // A site switch invalidates the location pick — the
                  // previous location may belong to the old site.
                  changeLocation(null);
                  setSiteId(next);
                }}
                error={fieldErrors.siteId}
              />
            ) : null}
            {showLocationSelect ? (
              <SelectField
                id="request-location"
                label="Location"
                items={
                  showSiteSelect && siteId === null
                    ? [
                        {
                          label: "Select a site first",
                          value: null,
                          disabled: true,
                        },
                      ]
                    : toSelectItems(locationOptions, "Select a location")
                }
                value={locationId}
                onChange={changeLocation}
                error={fieldErrors.siteLocationId}
              />
            ) : null}
          </div>
        )}

        {isEdit ? null : (
          <Field>
            <FieldLabel htmlFor="request-type">Request type</FieldLabel>
            <Select
              items={[
                { value: "weekly", label: "Weekly" },
                { value: "daily", label: "Daily" },
              ]}
              value={type_}
              onValueChange={(next) => {
                if (next === "weekly" || next === "daily") switchType(next);
              }}
            >
              <SelectTrigger id="request-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}

        {weekly ? (
          <Field data-invalid={fieldErrors.weekStart ? "true" : undefined}>
            <FieldLabel htmlFor="request-week-start">Week start</FieldLabel>
            <Input
              id="request-week-start"
              type="date"
              value={weekStart}
              onChange={(event) => changeWeekStart(event.target.value)}
              aria-invalid={fieldErrors.weekStart ? true : undefined}
              disabled={isEdit}
              required
            />
            {fieldErrors.weekStart ? (
              <FieldError errors={[{ message: fieldErrors.weekStart }]} />
            ) : null}
          </Field>
        ) : (
          <Field data-invalid={fieldErrors.requestDate ? "true" : undefined}>
            <FieldLabel htmlFor="request-request-date">Request date</FieldLabel>
            <Input
              id="request-request-date"
              type="date"
              value={requestDate}
              onChange={(event) => setRequestDate(event.target.value)}
              aria-invalid={fieldErrors.requestDate ? true : undefined}
              disabled={isEdit}
              required
            />
            {fieldErrors.requestDate ? (
              <FieldError errors={[{ message: fieldErrors.requestDate }]} />
            ) : null}
          </Field>
        )}

        {fieldErrors.lines ? (
          <FieldError errors={[{ message: fieldErrors.lines }]} />
        ) : null}

        {dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {weekly
              ? "Pick a week to open the requirement grid."
              : "Pick a date to open the requirement grid."}
          </p>
        ) : catalog.length === 0 && inactivePairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {configureHint ??
              "This location has no active work areas or shifts yet."}
          </p>
        ) : showCopyStep ? (
          <div
            role="group"
            aria-labelledby="request-copy-step-title"
            className="flex flex-col gap-3 rounded-md border bg-muted/30 p-4"
          >
            <p id="request-copy-step-title" className="font-medium">
              How do you want to start this week?
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="h-11 md:h-8"
                disabled={!copySource}
                aria-describedby="request-copy-step-note"
                onClick={copyFromSource}
              >
                <CopyIcon data-icon="inline-start" />
                {copySource
                  ? `Copy from week of ${copySource.weekStart}`
                  : "Copy from an earlier week"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-8"
                onClick={() => setStep("grid")}
              >
                Start blank
              </Button>
            </div>
            <p
              id="request-copy-step-note"
              className="text-sm text-muted-foreground"
              aria-live="polite"
            >
              {copyPending
                ? "Looking for the last request…"
                : copySource
                  ? "Headcounts move to the same weekday of this week. Lines for areas, shifts or positions no longer active are left out."
                  : "No earlier request to copy for this location."}
            </p>
            {configureHint ? (
              <p className="text-sm text-muted-foreground">{configureHint}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {configureHint ? (
              <p className="text-sm text-muted-foreground">{configureHint}</p>
            ) : null}

            {groups.length === 0 && inactivePairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add an area to start.
              </p>
            ) : null}

            {groups.map((group) => {
              const open = !collapsed.has(group.workAreaId);
              const areaTotals = dayTotals(values, group.rows, dates);
              const areaWeek = areaTotals.reduce((sum, n) => sum + n, 0);
              const bodyId = `request-area-${group.workAreaId}`;
              return (
                <section
                  key={group.workAreaId}
                  aria-labelledby={`${bodyId}-title`}
                  className="rounded-md border"
                >
                  <div className="flex items-start gap-1 p-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => toggleArea(group.workAreaId)}
                      className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-start outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <ChevronDownIcon
                        aria-hidden
                        className={cn(
                          "mt-0.5 size-4 shrink-0 transition-transform",
                          !open && "-rotate-90",
                        )}
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span id={`${bodyId}-title`} className="font-medium">
                          {group.workAreaName}
                        </span>
                        <ul className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                          {weekly ? (
                            <>
                              {DAYS.map((day, i) => (
                                <li
                                  key={day}
                                >{`${day} ${areaTotals[i] ?? 0}`}</li>
                              ))}
                              <li className="font-medium text-foreground">{`Week ${areaWeek}`}</li>
                            </>
                          ) : (
                            <li>{`Total ${areaWeek}`}</li>
                          )}
                        </ul>
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 md:size-8"
                      aria-label={`Remove area ${group.workAreaName}`}
                      onClick={() => removeArea(group.workAreaId)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <div
                    id={bodyId}
                    hidden={!open}
                    className="relative overflow-x-auto border-t"
                  >
                    <table className="w-max min-w-full table-fixed border-collapse text-sm">
                      <GridColumns dates={dates} tail={weekly} />
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th
                            scope="col"
                            className={cn(
                              STICKY_CELL,
                              "bg-muted px-3 py-2 text-start font-medium",
                            )}
                          >
                            Shift / position
                          </th>
                          <DayHeaders type={type_} />
                          {weekly ? (
                            <th
                              scope="col"
                              className="px-2 py-2 text-center font-medium"
                            >
                              Same all days
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          // Best-effort per-line placement: the action's
                          // refusal keys are lines-array indexes
                          // (`lines.<i>[.field]`), not grid coordinates, so
                          // a row matching the index — if any — gets the
                          // message inline; the toast is the safety net.
                          const index = rows.indexOf(row);
                          const rowError =
                            fieldErrors[`lines.${index}`] ??
                            fieldErrors[`lines.${index}.date`] ??
                            fieldErrors[`lines.${index}.headcount`];
                          const label = `${row.workAreaName} / ${row.shiftLabel} / ${row.positionName}`;
                          return (
                            <Fragment key={row.key}>
                              <tr className="border-b last:border-b-0">
                                <th
                                  scope="row"
                                  className={cn(
                                    STICKY_CELL,
                                    "px-3 py-1.5 text-start font-normal",
                                  )}
                                >
                                  {`${row.shiftLabel} / ${row.positionName}`}
                                </th>
                                {dates.map((date) => {
                                  const key = `${row.key}|${date}`;
                                  return (
                                    <td key={date} className="px-1 py-1.5">
                                      <Input
                                        aria-label={`Headcount ${label} / ${date}`}
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={999}
                                        step={1}
                                        className="h-10 w-14 text-center tabular-nums md:h-8"
                                        value={values[key] ?? ""}
                                        onChange={(event) =>
                                          setValues((prev) => ({
                                            ...prev,
                                            [key]: normalizeHeadcount(
                                              event.target.value,
                                            ),
                                          }))
                                        }
                                      />
                                    </td>
                                  );
                                })}
                                {weekly ? (
                                  <td className="px-2 py-1.5">
                                    <span className="flex items-center gap-1">
                                      <Input
                                        aria-label={`Same all days ${label}`}
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={999}
                                        className="h-10 w-14 text-center tabular-nums md:h-8"
                                        value={quickFill[row.key] ?? ""}
                                        onChange={(event) =>
                                          setQuickFill((prev) => ({
                                            ...prev,
                                            [row.key]: normalizeHeadcount(
                                              event.target.value,
                                            ),
                                          }))
                                        }
                                      />
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-10 md:size-8"
                                        aria-label={`Fill every day ${label}`}
                                        onClick={() => applyQuickFill(row)}
                                      >
                                        <PaintBucketIcon />
                                      </Button>
                                    </span>
                                  </td>
                                ) : null}
                              </tr>
                              {rowError ? (
                                <tr className="border-b">
                                  <td
                                    colSpan={columnCount}
                                    className="px-3 py-1 text-xs text-destructive"
                                  >
                                    {rowError}
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}

            {inactivePairs.length > 0 ? (
              <div className="relative overflow-x-auto rounded-md border">
                <table className="w-max min-w-full table-fixed border-collapse text-sm">
                  <GridColumns dates={dates} tail={weekly} />
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th
                        scope="col"
                        className={cn(
                          STICKY_CELL,
                          "bg-muted px-3 py-2 text-start font-medium",
                        )}
                      >
                        No longer active
                      </th>
                      <DayHeaders type={type_} />
                      {weekly ? (
                        <th scope="col">
                          <span className="sr-only">Remove</span>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {inactivePairs.map((pair) => (
                      <tr
                        key={triple(pair)}
                        className="border-b bg-muted/30 text-muted-foreground last:border-b-0"
                      >
                        <th
                          scope="row"
                          className="px-3 py-1.5 text-start font-normal"
                        >
                          {`${pair.workAreaName} / ${pair.shiftLabel} / ${pair.positionName}`}
                          <span className="block text-xs">
                            Inactive — keep unchanged or remove
                          </span>
                        </th>
                        {dates.map((date) => {
                          const cell = pair.dates.includes(date)
                            ? values[`${triple(pair)}|${date}`]
                            : undefined;
                          return (
                            <td
                              key={date}
                              className="px-1 py-1.5 text-center tabular-nums"
                            >
                              {cell ?? ""}
                            </td>
                          );
                        })}
                        {weekly ? (
                          <td className="px-2 py-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-10 md:size-8"
                              aria-label={`Remove inactive line ${pair.workAreaName} / ${pair.shiftLabel} / ${pair.positionName}`}
                              onClick={() => removePair(pair)}
                            >
                              <EraserIcon />
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {weekly ? null : (
                  // Daily has no tail column, so the remove controls sit
                  // under the table.
                  <div className="flex flex-wrap gap-2 border-t p-2">
                    {inactivePairs.map((pair) => (
                      <Button
                        key={triple(pair)}
                        type="button"
                        variant="outline"
                        className="h-11 md:h-8"
                        onClick={() => removePair(pair)}
                      >
                        <EraserIcon data-icon="inline-start" />
                        {`Remove inactive line ${pair.workAreaName} / ${pair.shiftLabel} / ${pair.positionName}`}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {totalRows.length > 0 ? (
              <div className="relative overflow-x-auto rounded-md border bg-muted/40">
                <table className="w-max min-w-full table-fixed border-collapse text-sm tabular-nums">
                  <GridColumns dates={dates} tail={weekly} />
                  <tbody>
                    <tr>
                      <th
                        scope="row"
                        className="sticky left-0 z-1 bg-muted px-3 py-2 text-start font-medium"
                      >
                        Total
                      </th>
                      {totals.map((count, i) => (
                        <td
                          key={dates[i]}
                          className="px-1 py-2 text-center font-medium"
                        >
                          {weekly ? (
                            <span className="sr-only">{`${DAYS[i]} `}</span>
                          ) : null}
                          {count}
                        </td>
                      ))}
                      {weekly ? (
                        <td className="px-2 py-2 font-semibold">
                          <span className="sr-only">Week total </span>
                          {weekTotal}
                        </td>
                      ) : null}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}

            {addableAreas.length > 0 ? (
              <div
                role="group"
                aria-labelledby="request-add-area-label"
                className="flex flex-col gap-2"
              >
                <p id="request-add-area-label" className="text-sm font-medium">
                  Add area
                </p>
                <div className="flex flex-wrap gap-2">
                  {addableAreas.map((area) => (
                    <Button
                      key={area.workAreaId}
                      type="button"
                      variant="outline"
                      className="h-11 md:h-8"
                      aria-label={`Add ${area.workAreaName}`}
                      onClick={() => addArea(area.workAreaId)}
                    >
                      <PlusIcon data-icon="inline-start" />
                      {area.workAreaName}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save lines" : "Submit request"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

// Full-page host for RequestForm: function props cannot cross the
// server→client boundary, so the page renders this thin client wrapper and
// the wrapper supplies onSaved (back to the list on a successful save).
// Its only remaining callers are the two pages (#130 — the dialogs went).
export function RequestFormPage(
  props: Omit<ComponentProps<typeof RequestForm>, "onSaved">,
) {
  const router = useRouter();
  return (
    <RequestForm
      {...props}
      onSaved={() => router.push("/dashboard/requests")}
    />
  );
}
