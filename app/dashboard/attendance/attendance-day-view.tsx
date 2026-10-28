"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildDayRows,
  filterDayRows,
  summarizeDayRows,
} from "@/lib/attendance-day";
import type {
  AttendanceStatus,
  DayData,
  DayRow,
} from "@/types/attendance";
import { TIMEZONE_LABELS } from "@/types/timezone";

import {
  STATUS_LABELS,
  STATUS_ORDER,
  commitBulk,
  commitRecord,
  isPushableDate,
  selectedUnrecordedIds,
  unrecordedWorkerIds,
  type Outcome,
} from "./attendance-commit";
import { CorrectDialog } from "./correct-dialog";
import {
  RemoveUnscheduledDialog,
  UnscheduledDialog,
} from "./unscheduled-dialog";

// The day page's client shell: the filter row, the summary, the list and, for
// the location admin, the write controls. The list is built here from DayData
// (the pure builder of lib/attendance-day), so a filter change is a URL push
// and nothing else. Everything it shows was loaded and scoped server-side, and
// every write goes through a server action that checks the role again.

const ALL = "all";

// The checkbox itself stays small; this stretches its clickable area to the
// 44px a thumb needs without moving the row.
const TAP_TARGET =
  "relative after:absolute after:-inset-3.5 after:content-['']";

type Option = { label: string; value: string };

const STATUS_BADGE: Record<
  AttendanceStatus,
  "success" | "secondary" | "destructive"
> = {
  present: "success",
  leave: "secondary",
  sick: "secondary",
  absent: "destructive",
};

function StatusBadge({ row }: { row: DayRow }) {
  if (!row.record) return <Badge variant="outline">Unrecorded</Badge>;
  return (
    <Badge variant={STATUS_BADGE[row.record.status]}>
      {STATUS_LABELS[row.record.status]}
    </Badge>
  );
}

function FilterSelect({
  id,
  label,
  items,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  items: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field className="w-full sm:w-48">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onChange(next ?? ALL)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

export function AttendanceDayView({
  date,
  canWrite,
  future,
  locationOptions,
  locationId,
  data,
  shiftId,
  areaId,
}: {
  date: string;
  // Only the location's admin writes; ho and superadmin get the same page.
  canWrite: boolean;
  future: boolean;
  locationOptions: { id: string; label: string }[];
  locationId: string;
  data: DayData;
  shiftId: string | null;
  areaId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [dateDraft, setDateDraft] = useState(date);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<AttendanceStatus>("present");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  // A future date can be looked at but never written.
  const writable = canWrite && !future;

  const pushWith = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    startTransition(() => {
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    });
  };

  // A filter value is stored in the URL, "all" removes it.
  const setParam = (key: string, value: string) =>
    pushWith((params) => {
      if (value === ALL || value === "") params.delete(key);
      else params.set(key, value);
    });

  // One write at a time: the outcome is toasted, a stale view is refreshed.
  const run = (task: () => Promise<Outcome>, onSuccess?: () => void) =>
    startTransition(async () => {
      const outcome = await task();
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
      if (outcome.refresh) router.refresh();
      if (outcome.ok) onSuccess?.();
    });

  const shiftLabels = useMemo(
    () => new Map(data.shifts.map((s) => [s.id, s.label])),
    [data.shifts],
  );
  const areaNames = useMemo(
    () => new Map(data.areas.map((a) => [a.id, a.name])),
    [data.areas],
  );

  const allRows = useMemo(
    () => buildDayRows(data.roster, data.records),
    [data.roster, data.records],
  );
  const rows = useMemo(() => {
    const identity = (row: DayRow) => data.workers[row.workerId];
    return filterDayRows(allRows, {
      shiftDefId: shiftId ?? undefined,
      workAreaId: areaId ?? undefined,
    }).sort(
      (a, b) =>
        (identity(a)?.employeeId ?? "").localeCompare(
          identity(b)?.employeeId ?? "",
        ) || a.workerId.localeCompare(b.workerId),
    );
  }, [allRows, data.workers, shiftId, areaId]);
  const summary = summarizeDayRows(rows);

  const workerLabel = (workerId: string): string => {
    const worker = data.workers[workerId];
    return worker ? `${worker.employeeId} ${worker.name}` : "Unknown worker";
  };
  const employeeId = (workerId: string): string =>
    data.workers[workerId]?.employeeId ?? "Unknown";

  const unrecordedIds = unrecordedWorkerIds(rows);
  const selectedIds = selectedUnrecordedIds(rows, selected);
  const allSelected =
    unrecordedIds.length > 0 && selectedIds.length === unrecordedIds.length;
  const editingRow = rows.find((r) => r.workerId === editingId);
  const removingRow = rows.find((r) => r.workerId === removingId);

  const toggleSelected = (workerId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(workerId);
      else next.delete(workerId);
      return next;
    });

  const mark = (workerId: string, status: AttendanceStatus) =>
    run(() =>
      commitRecord({ date, workerId, status }, workerLabel(workerId)),
    );
  const markBulk = (workerIds: string[], status: AttendanceStatus) =>
    run(
      () => commitBulk({ date, workerIds, status }),
      () => setSelected(new Set()),
    );

  const shiftItems: Option[] = [
    { label: "All shifts", value: ALL },
    ...data.shifts.map((s) => ({ label: s.label, value: s.id })),
  ];
  const areaItems: Option[] = [
    { label: "All work areas", value: ALL },
    ...data.areas.map((a) => ({ label: a.name, value: a.id })),
  ];
  const locationItems: Option[] = locationOptions.map((o) => ({
    label: o.label,
    value: o.id,
  }));
  const statusItems: Option[] = STATUS_ORDER.map((status) => ({
    label: STATUS_LABELS[status],
    value: status,
  }));
  const locationLabel =
    locationOptions.find((o) => o.id === locationId)?.label ?? "Location";

  const zone = `${TIMEZONE_LABELS[data.timezone]} (${data.timezone})`;
  const summaryItems: { label: string; count: number }[] = [
    { label: "Unrecorded", count: summary.unrecorded },
    { label: "Present", count: summary.present },
    { label: "Sick", count: summary.sick },
    { label: "Leave", count: summary.leave },
    { label: "Absent", count: summary.absent },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="page-title" tabIndex={-1} data-focus-fallback>
          Attendance
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Who worked which shift on a day. Every rostered worker starts as
          unrecorded until the location admin marks them.
        </p>
      </div>

      <FieldGroup className="flex-row flex-wrap items-end gap-3">
        {locationOptions.length > 1 ? (
          <FilterSelect
            id="attendance-location"
            label="Location"
            items={locationItems}
            value={locationId}
            onChange={(value) => setParam("location", value)}
          />
        ) : (
          <div className="flex w-full flex-col gap-2 text-sm sm:w-auto">
            <span className="font-medium">Location</span>
            <span className="flex h-8 items-center">{locationLabel}</span>
          </div>
        )}

        <Field className="w-full sm:w-48">
          <FieldLabel htmlFor="attendance-date">Date</FieldLabel>
          <Input
            id="attendance-date"
            type="date"
            value={dateDraft}
            onChange={(event) => {
              // The field keeps what is typed; the URL only follows once it
              // holds a complete date (the view remounts on a new date).
              setDateDraft(event.target.value);
              if (isPushableDate(event.target.value)) {
                setParam("date", event.target.value);
              }
            }}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => setParam("date", ALL)}
        >
          Today
        </Button>

        <FilterSelect
          id="attendance-shift"
          label="Shift"
          items={shiftItems}
          value={shiftId ?? ALL}
          onChange={(value) => setParam("shift", value)}
        />
        <FilterSelect
          id="attendance-area"
          label="Work area"
          items={areaItems}
          value={areaId ?? ALL}
          onChange={(value) => setParam("area", value)}
        />
      </FieldGroup>
      <p className="-mt-2 text-sm text-muted-foreground">
        Dates follow {zone}.
      </p>

      {!canWrite ? (
        <Alert>
          <AlertDescription>
            This page is read-only for your role. Only the location admin
            records attendance.
          </AlertDescription>
        </Alert>
      ) : future ? (
        <Alert>
          <AlertDescription>
            Attendance cannot be recorded for a future date.
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {summaryItems.map((item) => (
          <div key={item.label} className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="font-medium tabular-nums">{item.count}</dd>
          </div>
        ))}
      </dl>

      {writable ? (
        <div className="flex flex-wrap items-end gap-3">
          {unrecordedIds.length > 0 ? (
            <>
              <FilterSelect
                id="attendance-bulk-status"
                label="Mark selected as"
                items={statusItems}
                value={bulkStatus}
                onChange={(value) => setBulkStatus(value as AttendanceStatus)}
                disabled={isPending}
              />
              <Button
                type="button"
                disabled={isPending || selectedIds.length === 0}
                onClick={() => markBulk(selectedIds, bulkStatus)}
              >
                Mark selected
                {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setConfirmAll(true)}
              >
                Mark all unrecorded present ({unrecordedIds.length})
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => setAdding(true)}
          >
            Add unscheduled worker
          </Button>
        </div>
      ) : null}

      {allRows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Nobody is on the roster for this date, and no attendance has been
          recorded.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          No workers match these filters.
        </p>
      ) : (
        <Table className="min-w-160">
          <TableCaption className="sr-only">
            Attendance for {date}
          </TableCaption>
          <TableHeader>
            <TableRow>
              {writable ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all unrecorded rows"
                    className={TAP_TARGET}
                    checked={allSelected}
                    disabled={isPending || unrecordedIds.length === 0}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? new Set(unrecordedIds) : new Set())
                    }
                  />
                </TableHead>
              ) : null}
              <TableHead>Worker</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Shift and area</TableHead>
              {writable ? <TableHead>Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const worker = data.workers[row.workerId];
              const shiftDefId = row.record?.shiftDefId ?? row.rosterShiftDefId;
              const workAreaId = row.record?.workAreaId ?? row.rosterWorkAreaId;
              const who = employeeId(row.workerId);
              return (
                <TableRow key={row.workerId}>
                  {writable ? (
                    <TableCell>
                      {row.state === "unrecorded" ? (
                        <Checkbox
                          aria-label={`Select ${who}`}
                          className={TAP_TARGET}
                          checked={selected.has(row.workerId)}
                          disabled={isPending}
                          onCheckedChange={(checked) =>
                            toggleSelected(row.workerId, checked)
                          }
                        />
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {worker?.employeeId ?? "Unknown"}
                      </span>
                      <span className="text-muted-foreground">
                        {worker?.name ?? "Unknown worker"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge row={row} />
                        {row.state === "unscheduled" ? (
                          <Badge variant="outline">Unscheduled</Badge>
                        ) : null}
                        {row.shiftDiffers && row.rosterShiftDefId ? (
                          <Badge variant="secondary">Shift differs</Badge>
                        ) : null}
                      </div>
                      {row.shiftDiffers && row.rosterShiftDefId ? (
                        <span className="text-xs text-muted-foreground">
                          Rostered: {shiftLabels.get(row.rosterShiftDefId)}
                        </span>
                      ) : null}
                      {row.record?.reason ? (
                        <span className="max-w-64 text-xs text-muted-foreground">
                          {row.record.reason}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>
                        {(shiftDefId && shiftLabels.get(shiftDefId)) || "None"}
                      </span>
                      <span className="text-muted-foreground">
                        {(workAreaId && areaNames.get(workAreaId)) || "None"}
                      </span>
                    </div>
                  </TableCell>
                  {writable ? (
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.state === "unrecorded" ? (
                          STATUS_ORDER.map((status) => (
                            <Button
                              key={status}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="min-h-11 sm:min-h-0"
                              aria-label={`Mark ${who} as ${status}`}
                              disabled={isPending}
                              onClick={() => mark(row.workerId, status)}
                            >
                              {STATUS_LABELS[status]}
                            </Button>
                          ))
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-h-11 sm:min-h-0"
                              aria-label={`Edit ${who}`}
                              disabled={isPending}
                              onClick={() => setEditingId(row.workerId)}
                            >
                              Edit
                            </Button>
                            {row.state === "unscheduled" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="min-h-11 sm:min-h-0"
                                aria-label={`Remove ${who}`}
                                disabled={isPending}
                                onClick={() => setRemovingId(row.workerId)}
                              >
                                Remove
                              </Button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {writable ? (
        <>
          <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Mark all unrecorded as present?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {unrecordedIds.length} unrecorded worker
                  {unrecordedIds.length === 1 ? "" : "s"} on this list will be
                  marked present for {date}. A later change to any of them needs
                  a correction with a reason.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isPending}
                  onClick={() => markBulk(unrecordedIds, "present")}
                >
                  Mark present
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {editingRow?.record ? (
            <CorrectDialog
              key={editingRow.workerId}
              row={editingRow}
              shifts={data.shifts}
              date={date}
              workerLabel={workerLabel(editingRow.workerId)}
              onDone={() => setEditingId(null)}
            />
          ) : null}
          {removingRow?.record ? (
            <RemoveUnscheduledDialog
              key={removingRow.workerId}
              row={removingRow}
              workerLabel={workerLabel(removingRow.workerId)}
              onDone={() => setRemovingId(null)}
            />
          ) : null}
          {adding ? (
            <UnscheduledDialog
              date={date}
              candidates={data.candidates}
              excludeWorkerIds={allRows.map((r) => r.workerId)}
              shifts={data.shifts}
              areas={data.areas}
              onDone={() => setAdding(false)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
