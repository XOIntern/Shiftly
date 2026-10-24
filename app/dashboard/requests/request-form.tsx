"use client";

import { Fragment, useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { EraserIcon, SparklesIcon, CalendarPlusIcon } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Pure grid primitives (exported for the form tests — bun test has no DOM,
// so the interactions are asserted through these helpers).
// ---------------------------------------------------------------------------

// The headcount input lives in state as a string keyed
// `${workAreaId}|${shiftDefinitionId}|${date}` — one map serves the weekly
// 7-day grid and the daily single-date grid alike.
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
};

// A grid row per active work area × active shift of the location — the
// cross product the spec's grid is built on. Other locations' masters
// never enter (the dialog masters arrive scoped per role).
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
      rows.push({
        key: `${workArea.id}|${shift.id}`,
        workAreaId: workArea.id,
        workAreaName: workArea.name,
        shiftDefinitionId: shift.id,
        shiftLabel: shift.label,
      });
    }
  }
  return rows;
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
      const [workAreaId, shiftDefinitionId, date] = key.split("|");
      return { workAreaId, shiftDefinitionId, date, headcount: Number(headcount) };
    })
    .filter((line) => allowed.has(line.date) && line.headcount > 0)
    .sort(
      (a, b) =>
        `${a.workAreaId}${a.shiftDefinitionId}${a.date}`.localeCompare(
          `${b.workAreaId}${b.shiftDefinitionId}${b.date}`,
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
  notes: string;
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
    notes: state.notes.trim() ? state.notes.trim() : undefined,
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
  dates: string[];
};

// Lines whose work area / shift pair is missing from the location's active
// masters (Task 7 note: such lines can only be kept unchanged or removed —
// re-adding an inactive reference is refused by the action).
export function inactiveLinePairs(
  lines: MpRequestLineView[],
  activeWorkAreas: MpRequestGridWorkArea[],
  activeShifts: MpRequestGridShift[],
): InactivePair[] {
  const activeWorkAreaIds = new Set(activeWorkAreas.map((row) => row.id));
  const activeShiftIds = new Set(activeShifts.map((row) => row.id));

  const pairs: InactivePair[] = [];
  const indexOf = new Map<string, number>();
  for (const line of lines) {
    if (activeWorkAreaIds.has(line.workAreaId) && activeShiftIds.has(line.shiftDefinitionId)) {
      continue;
    }
    const key = `${line.workAreaId}|${line.shiftDefinitionId}`;
    const index = indexOf.get(key);
    if (index === undefined) {
      indexOf.set(key, pairs.length);
      pairs.push({
        workAreaId: line.workAreaId,
        workAreaName: line.workAreaName,
        shiftDefinitionId: line.shiftDefinitionId,
        shiftLabel: line.shiftLabel,
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
        `${line.workAreaId}|${line.shiftDefinitionId}|${line.date}`,
        String(line.headcount),
      ]),
    ),
  );
  const [removedPairs, setRemovedPairs] = useState<Set<string>>(new Set());
  const [quickFill, setQuickFill] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
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
  const rows = gridRows(
    activeWorkAreas,
    activeShifts,
    effectiveLocationId ?? null,
  );
  const inactivePairs = request
    ? inactiveLinePairs(request.lines, activeWorkAreas, activeShifts).filter(
        (pair) =>
          !removedPairs.has(
            `${pair.workAreaId}|${pair.shiftDefinitionId}`,
          ),
      )
    : [];

  const cellKey = (
    workAreaId: string,
    shiftDefinitionId: string,
    date: string,
  ) => `${workAreaId}|${shiftDefinitionId}|${date}`;

  function removePair(pair: InactivePair) {
    setValues((prev) => {
      const next = { ...prev };
      for (const date of pair.dates) {
        delete next[cellKey(pair.workAreaId, pair.shiftDefinitionId, date)];
      }
      return next;
    });
    setRemovedPairs((prev) =>
      new Set(prev).add(`${pair.workAreaId}|${pair.shiftDefinitionId}`),
    );
  }

  function applyQuickFill(row: GridRow) {
    const spread = quickFillCells(quickFill[row.key] ?? "", dates);
    setValues((prev) => {
      const next = { ...prev };
      for (const date of dates) {
        next[cellKey(row.workAreaId, row.shiftDefinitionId, date)] =
          spread[date];
      }
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors({});
    setMessage(undefined);

    // A removed inactive pair drops its keys before the payload builds.
    const removedPrefixes = [...removedPairs].map((pairKey) => `${pairKey}|`);
    const liveValues: GridValues = {};
    for (const [key, count] of Object.entries(values)) {
      if (removedPrefixes.some((prefix) => key.startsWith(prefix))) continue;
      liveValues[key] = count;
    }

    const built = buildCreateInput({
      type: type_,
      weekStart: weekStart || null,
      requestDate: requestDate || null,
      notes,
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
                  setLocationId(null);
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
                onChange={setLocationId}
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
        ) : rows.length === 0 && inactivePairs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This location has no active work areas or shifts yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
          {fieldErrors.lines ? (
            <FieldError errors={[{ message: fieldErrors.lines }]} />
          ) : null}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="min-w-[200px] px-3 py-2 text-start font-medium">
                    Work area / shift
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
                      {`${row.workAreaName} / ${row.shiftLabel}`}
                    </td>
                    {dates.map((date) => {
                      const key = cellKey(
                        row.workAreaId,
                        row.shiftDefinitionId,
                        date,
                      );
                      return (
                        <td key={date} className="px-2 py-1.5">
                          <Input
                            aria-label={`Headcount ${row.workAreaName} / ${row.shiftLabel} / ${date}`}
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
                            aria-label={`Same all days ${row.workAreaName} / ${row.shiftLabel}`}
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
                            aria-label={`Quick fill ${row.workAreaName} / ${row.shiftLabel}`}
                            onClick={() => applyQuickFill(row)}
                          >
                            <SparklesIcon />
                          </Button>
                        </span>
                      </td>
                    ) : null}
                      </tr>
                      {rowError ? (
                        <tr
                          key={`${row.key}-error`}
                          className="border-b"
                        >
                          <td
                            colSpan={dates.length + (type_ === "weekly" ? 2 : 1)}
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
                    key={`${pair.workAreaId}|${pair.shiftDefinitionId}`}
                    className="border-b bg-muted/30 text-muted-foreground"
                  >
                    <td className="px-3 py-1.5">
                      {`${pair.workAreaName} / ${pair.shiftLabel}`}
                      <span className="block text-xs">
                        Inactive — keep unchanged or remove
                      </span>
                    </td>
                    {dates.map((date) => {
                      const cell = pair.dates.includes(date)
                        ? values[cellKey(pair.workAreaId, pair.shiftDefinitionId, date)]
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
                    <td className="px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove inactive line ${pair.workAreaName} / ${pair.shiftLabel}`}
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
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="request-notes">Notes</FieldLabel>
          <Textarea
            id="request-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            rows={3}
            disabled={isEdit}
          />
        </Field>

        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save lines" : "Submit request"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function CreateRequestButton({
  siteLocations,
  sites,
  activeWorkAreas,
  activeShifts,
  pinnedLocationName,
}: {
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  activeWorkAreas: MpRequestGridWorkArea[];
  activeShifts: MpRequestGridShift[];
  pinnedLocationName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <CalendarPlusIcon data-icon="inline-start" />
        New request
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New request</DialogTitle>
          <DialogDescription>
            Weekly requests anchor on a Monday and carry one line per work
            area, shift and day; daily requests target a single date.
          </DialogDescription>
        </DialogHeader>
        <RequestForm
          type="weekly"
          siteLocations={siteLocations}
          sites={sites}
          activeWorkAreas={activeWorkAreas}
          activeShifts={activeShifts}
          pinnedLocationName={pinnedLocationName}
          siteLocationId={
            pinnedLocationName !== undefined
              ? siteLocations[0]?.id
              : undefined
          }
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

// Full-page host for RequestForm: function props cannot cross the
// server→client boundary, so the page renders this thin client wrapper and
// the wrapper supplies onSaved (back to the list on a successful save).
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
