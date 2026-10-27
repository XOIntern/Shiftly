"use client";

import { Fragment, useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { EraserIcon, SparklesIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import type {
  MpRequestGridShift,
  MpRequestGridWorkArea,
  MpRequestLineView,
} from "@/types/mp-request";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import { GENERIC_ERROR } from "@/lib/action-state";
import { mondayOf, weekDates } from "@/lib/week";
import {
  createRequest,
  updateRequestLines,
} from "@/app/dashboard/requests/actions";
import type { MpRequestCreateInput } from "@/validation/request-line";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
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

// gridRows is the catalog of admissible rows (#147): the grid only shows the
// rows the admin added, keyed `workAreaId|shiftId|positionId`.

// What the Add bar offers: every catalog area and shift (in catalog order),
// and only the picked area's required positions — no area picked, no
// positions.
export function rowPickerOptions(
  catalog: GridRow[],
  pickedWorkAreaId: string | null,
) {
  const workAreas = new Map<string, string>();
  const shifts = new Map<string, string>();
  const positions = new Map<string, string>();
  for (const row of catalog) {
    workAreas.set(row.workAreaId, row.workAreaName);
    shifts.set(row.shiftDefinitionId, row.shiftLabel);
    if (row.workAreaId === pickedWorkAreaId) {
      positions.set(row.positionId, row.positionName);
    }
  }
  return {
    workAreas: [...workAreas].map(([id, name]) => ({ id, name })),
    shifts: [...shifts].map(([id, label]) => ({ id, label })),
    positions: [...positions].map(([id, name]) => ({ id, name })),
  };
}

// The added keys plus the picked shifts × positions of one area. Walking the
// catalog makes ids outside it (a stale position pick) add nothing, and the
// Set makes an already-added combination a no-op.
export function addRowKeys(
  catalog: GridRow[],
  added: ReadonlySet<string>,
  workAreaId: string,
  shiftIds: string[],
  positionIds: string[],
): Set<string> {
  const next = new Set(added);
  for (const row of catalog) {
    if (
      row.workAreaId === workAreaId &&
      shiftIds.includes(row.shiftDefinitionId) &&
      positionIds.includes(row.positionId)
    ) {
      next.add(row.key);
    }
  }
  return next;
}

// The rows the grid renders: the added catalog rows, in catalog order.
export function visibleRows(
  catalog: GridRow[],
  added: ReadonlySet<string>,
): GridRow[] {
  return catalog.filter((row) => added.has(row.key));
}

// Edit seeds the grid from the stored lines whose triple is in the catalog;
// triples that left the active masters keep their inactive-pair rows instead.
export function initialAddedKeys(
  catalog: GridRow[],
  lines: MpRequestLineView[],
): Set<string> {
  const catalogKeys = new Set(catalog.map((row) => row.key));
  const keys = new Set<string>();
  for (const line of lines) {
    const key = `${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}`;
    if (catalogKeys.has(key)) keys.add(key);
  }
  return keys;
}

const rowKeyOfCell = (cellKey: string) => cellKey.split("|").slice(0, 3).join("|");

// Removing a row deletes its cells, so re-adding it starts blank.
export function dropRowValues(values: GridValues, rowKey: string): GridValues {
  return Object.fromEntries(
    Object.entries(values).filter(([cell]) => rowKeyOfCell(cell) !== rowKey),
  );
}

// Keeps only the cells of rows still in the grid, so stale values (another
// location's rows, removed rows) never reach the submit payload.
export function pruneValues(
  values: GridValues,
  keptRowKeys: ReadonlySet<string>,
): GridValues {
  return Object.fromEntries(
    Object.entries(values).filter(([cell]) => keptRowKeys.has(rowKeyOfCell(cell))),
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
    .sort(
      (a, b) =>
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

type PickOption = { id: string; name: string };

// Multi-select of the Add bar: chips over a Combobox, like the work-area
// form's position picker.
function MultiPickField({
  id,
  label,
  options,
  selectedIds,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  options: PickOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  // Chips are positional in Base UI, so the value array follows the chip
  // order; ids no longer on offer drop out.
  const selected = selectedIds.flatMap((selectedId) => {
    const option = options.find((candidate) => candidate.id === selectedId);
    return option ? [option] : [];
  });
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Combobox
        multiple
        items={options}
        itemToStringLabel={(option) => option.name}
        isItemEqualToValue={(option, value) => option.id === value.id}
        value={selected}
        onValueChange={(next) => onChange(next.map((option) => option.id))}
        disabled={disabled}
      >
        <ComboboxChips>
          <ComboboxValue>
            {selected.map((option) => (
              <ComboboxChip
                key={option.id}
                aria-label={option.name}
                removeLabel={`Remove ${option.name}`}
              >
                {option.name}
              </ComboboxChip>
            ))}
          </ComboboxValue>
          <ComboboxChipsInput id={id} placeholder={placeholder} />
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxEmpty>No matches.</ComboboxEmpty>
          <ComboboxList>
            {(option: PickOption) => (
              <ComboboxItem key={option.id} value={option}>
                {option.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
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
  const head = entries
    .slice(0, 3)
    .map(([key, error]) => `${key}: ${error}`);
  return entries.length > 3
    ? `${head.join(" · ")} (+${entries.length - 3} more)`
    : head.join(" · ");
}

// The toast text a failed action result must produce: its `message` when
// one exists, else a summary of its fieldErrors (never silent).
export function refusalToast(
  result: ActionState,
): string | null {
  if (result.ok) return null;
  if (result.message) return result.message;
  return fieldErrorsSummary(result.fieldErrors ?? {});
}

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
  // Pre-filled anchors (tests; a re-opened dialog could restore state). The
  // edit variant ignores them — its anchor comes from the stored request.
  defaultWeekStart?: string;
  defaultRequestDate?: string;
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
    (request?.type === "weekly")
      ? anchor
      : (defaultWeekStart ?? ""),
  );
  const [requestDate, setRequestDate] = useState(
    (request?.type === "daily")
      ? anchor
      : (defaultRequestDate ?? ""),
  );
  // Existing lines pre-fill the grid (edit); inactive-pair keys ride the
  // same map so their submitted tuples re-travel byte-identical.
  const [values, setValues] = useState<GridValues>(() =>
    Object.fromEntries(
      (request?.lines ?? []).map((line) => [
        `${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}|${line.date}`,
        String(line.headcount),
      ]),
    ),
  );
  const [removedPairs, setRemovedPairs] = useState<Set<string>>(new Set());
  // The rows the admin added (#147) and the Add bar's current picks. Create
  // starts empty; edit seeds the rows from the stored lines (its location is
  // the immutable prop, so the catalog is already known).
  const [addedKeys, setAddedKeys] = useState<Set<string>>(() =>
    request
      ? initialAddedKeys(
          gridRows(activeWorkAreas, activeShifts, siteLocationId ?? null),
          request.lines,
        )
      : new Set(),
  );
  const [pickedWorkAreaId, setPickedWorkAreaId] = useState<string | null>(null);
  const [pickedShiftIds, setPickedShiftIds] = useState<string[]>([]);
  const [pickedPositionIds, setPickedPositionIds] = useState<string[]>([]);
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
    : ((pinnedLocationName !== undefined
        ? siteLocations[0]?.id
        : locationId) ?? undefined);

  const dates = gridDates(type_, type_ === "weekly" ? weekStart : requestDate);
  const catalog = gridRows(
    activeWorkAreas,
    activeShifts,
    effectiveLocationId ?? null,
  );
  const rows = visibleRows(catalog, addedKeys);
  const picker = rowPickerOptions(catalog, pickedWorkAreaId);
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
        (pair) =>
          !removedPairs.has(
            `${pair.workAreaId}|${pair.shiftDefinitionId}|${pair.positionId}`,
          ),
      )
    : [];

  const cellKey = (
    workAreaId: string,
    shiftDefinitionId: string,
    positionId: string,
    date: string,
  ) => `${workAreaId}|${shiftDefinitionId}|${positionId}|${date}`;

  function removePair(pair: InactivePair) {
    setValues((prev) => {
      const next = { ...prev };
      for (const date of pair.dates) {
        delete next[
          cellKey(pair.workAreaId, pair.shiftDefinitionId, pair.positionId, date)
        ];
      }
      return next;
    });
    setRemovedPairs((prev) =>
      new Set(prev).add(
        `${pair.workAreaId}|${pair.shiftDefinitionId}|${pair.positionId}`,
      ),
    );
  }

  // The added rows belong to one location's catalog: a location move starts
  // the grid over (stale cells are also pruned on submit).
  function changeLocation(next: string | null) {
    if (next !== locationId) {
      setAddedKeys(new Set());
      setPickedWorkAreaId(null);
      setPickedShiftIds([]);
      setPickedPositionIds([]);
    }
    setLocationId(next);
  }

  function pickWorkArea(next: string) {
    // The positions on offer belong to the picked area.
    if (next !== pickedWorkAreaId) setPickedPositionIds([]);
    setPickedWorkAreaId(next);
  }

  const canAddRows =
    pickedWorkAreaId !== null &&
    pickedShiftIds.length > 0 &&
    pickedPositionIds.length > 0;

  function addRows() {
    if (!canAddRows) return;
    setAddedKeys((prev) =>
      addRowKeys(
        catalog,
        prev,
        pickedWorkAreaId,
        pickedShiftIds,
        pickedPositionIds,
      ),
    );
    // The area stays picked so the next shifts/positions can be added fast.
    setPickedShiftIds([]);
    setPickedPositionIds([]);
  }

  function removeRow(row: GridRow) {
    setAddedKeys((prev) => {
      const next = new Set(prev);
      next.delete(row.key);
      return next;
    });
    setValues((prev) => dropRowValues(prev, row.key));
    setQuickFill((prev) => {
      const next = { ...prev };
      delete next[row.key];
      return next;
    });
  }

  function applyQuickFill(row: GridRow) {
    const spread = quickFillCells(quickFill[row.key] ?? "", dates);
    setValues((prev) => {
      const next = { ...prev };
      for (const date of dates) {
        next[
          cellKey(row.workAreaId, row.shiftDefinitionId, row.positionId, date)
        ] = spread[date];
      }
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors({});
    setMessage(undefined);

    // Only the grid's rows travel: the added rows plus the inactive pairs
    // kept unchanged. Removed pairs and stale cells drop out here.
    const liveValues = pruneValues(
      values,
      new Set([
        ...rows.map((row) => row.key),
        ...inactivePairs.map(
          (pair) =>
            `${pair.workAreaId}|${pair.shiftDefinitionId}|${pair.positionId}`,
        ),
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
          <div className="grid grid-cols-2 gap-4">
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

        {type_ === "weekly" ? (
          <Field
            data-invalid={fieldErrors.weekStart ? "true" : undefined}
          >
            <FieldLabel htmlFor="request-week-start">Week start</FieldLabel>
            <Input
              id="request-week-start"
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
              aria-invalid={fieldErrors.weekStart ? true : undefined}
              disabled={isEdit}
              required
            />
            {fieldErrors.weekStart ? (
              <FieldError errors={[{ message: fieldErrors.weekStart }]} />
            ) : null}
          </Field>
        ) : (
          <Field
            data-invalid={fieldErrors.requestDate ? "true" : undefined}
          >
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

        {dates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {type_ === "weekly"
              ? "Pick a week to open the requirement grid."
              : "Pick a date to open the requirement grid."}
          </p>
        ) : catalog.length === 0 && inactivePairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {configureHint ??
              "This location has no active work areas or shifts yet."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
          {configureHint ? (
            <p className="text-sm text-muted-foreground">{configureHint}</p>
          ) : null}
          {catalog.length > 0 ? (
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <SelectField
                id="request-add-work-area"
                label="Work area"
                items={toSelectItems(picker.workAreas, "Select a work area")}
                value={pickedWorkAreaId}
                onChange={pickWorkArea}
              />
              <MultiPickField
                id="request-add-shifts"
                label="Shifts"
                options={picker.shifts.map((shift) => ({
                  id: shift.id,
                  name: shift.label,
                }))}
                selectedIds={pickedShiftIds}
                onChange={setPickedShiftIds}
                placeholder="Select shifts"
              />
              <MultiPickField
                id="request-add-positions"
                label="Positions"
                options={picker.positions}
                selectedIds={pickedPositionIds}
                onChange={setPickedPositionIds}
                placeholder={
                  pickedWorkAreaId === null
                    ? "Select a work area first"
                    : "Select positions"
                }
                disabled={pickedWorkAreaId === null}
              />
              <Button type="button" disabled={!canAddRows} onClick={addRows}>
                Add rows
              </Button>
            </div>
          ) : null}
          {fieldErrors.lines ? (
            <FieldError errors={[{ message: fieldErrors.lines }]} />
          ) : null}
          {rows.length === 0 && inactivePairs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add a work area, shift and position to start.
            </p>
          ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="min-w-50 px-3 py-2 text-start font-medium">
                    Work area / shift / position
                  </th>
                  {type_ === "weekly"
                    ? DAYS.map((day) => (
                        <th
                          key={day}
                          className="w-20 px-2 py-2 text-center font-medium"
                        >
                          {day}
                        </th>
                      ))
                    : (
                        <th className="w-24 px-2 py-2 text-center font-medium">
                          Headcount
                        </th>
                      )}
                  {type_ === "weekly" ? (
                    <th className="w-28 px-2 py-2 text-center font-medium">
                      Same all days
                    </th>
                  ) : null}
                  <th className="w-12 px-2 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  // Best-effort per-line placement: the action's refusal
                  // keys are lines-array indexes (`lines.<i>[.field]`), not
                  // grid coordinates, so a row matching the index — if any
                  // — gets the message inline; the toast is the safety net.
                  const rowError =
                    fieldErrors[`lines.${index}`] ??
                    fieldErrors[`lines.${index}.date`] ??
                    fieldErrors[`lines.${index}.headcount`];
                  return (
                    <Fragment key={row.key}>
                      <tr className="border-b">
                    <td className="px-3 py-1.5">
                      {`${row.workAreaName} / ${row.shiftLabel} / ${row.positionName}`}
                    </td>
                    {dates.map((date) => {
                      const key = cellKey(
                        row.workAreaId,
                        row.shiftDefinitionId,
                        row.positionId,
                        date,
                      );
                      return (
                        <td key={date} className="px-2 py-1.5">
                          <Input
                            aria-label={`Headcount ${row.workAreaName} / ${row.shiftLabel} / ${row.positionName} / ${date}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={999}
                            step={1}
                            className="h-8 w-16 text-center tabular-nums"
                            value={values[key] ?? ""}
                            onChange={(event) =>
                              setValues((prev) => ({
                                ...prev,
                                [key]: normalizeHeadcount(event.target.value),
                              }))
                            }
                          />
                        </td>
                      );
                    })}
                    {type_ === "weekly" ? (
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1">
                          <Input
                            aria-label={`Same all days ${row.workAreaName} / ${row.shiftLabel} / ${row.positionName}`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={999}
                            className="h-8 w-16 text-center tabular-nums"
                            value={quickFill[row.key] ?? ""}
                            onChange={(event) =>
                              setQuickFill((prev) => ({
                                ...prev,
                                [row.key]: normalizeHeadcount(event.target.value),
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Quick fill ${row.workAreaName} / ${row.shiftLabel} / ${row.positionName}`}
                            onClick={() => applyQuickFill(row)}
                          >
                            <SparklesIcon />
                          </Button>
                        </span>
                      </td>
                    ) : null}
                    <td className="px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove row ${row.workAreaName} / ${row.shiftLabel} / ${row.positionName}`}
                        onClick={() => removeRow(row)}
                      >
                        <XIcon />
                      </Button>
                    </td>
                      </tr>
                      {rowError ? (
                        <tr
                          key={`${row.key}-error`}
                          className="border-b"
                        >
                          <td
                            colSpan={dates.length + (type_ === "weekly" ? 3 : 2)}
                            className="px-3 py-1 text-xs text-destructive"
                          >
                            {rowError}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {inactivePairs.map((pair) => (
                  <tr
                    key={`${pair.workAreaId}|${pair.shiftDefinitionId}|${pair.positionId}`}
                    className="border-b bg-muted/30 text-muted-foreground"
                  >
                    <td className="px-3 py-1.5">
                      {`${pair.workAreaName} / ${pair.shiftLabel} / ${pair.positionName}`}
                      <span className="block text-xs">
                        Inactive — keep unchanged or remove
                      </span>
                    </td>
                    {dates.map((date) => {
                      const cell = pair.dates.includes(date)
                        ? values[
                            cellKey(
                              pair.workAreaId,
                              pair.shiftDefinitionId,
                              pair.positionId,
                              date,
                            )
                          ]
                        : undefined;
                      return (
                        <td
                          key={date}
                          className="px-2 py-1.5 text-center tabular-nums"
                        >
                          {cell ?? ""}
                        </td>
                      );
                    })}
                    {type_ === "weekly" ? <td /> : null}
                    <td className="px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove inactive line ${pair.workAreaName} / ${pair.shiftLabel} / ${pair.positionName}`}
                        onClick={() => removePair(pair)}
                      >
                        <EraserIcon />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
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
