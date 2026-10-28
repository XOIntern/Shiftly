"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
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

// The day page's client shell: the filter row, the summary and the list. The
// list itself is built here from DayData (the pure builder of
// lib/attendance-day), so a filter change is a URL push and nothing else.
// Everything it shows was loaded and scoped server-side.

const ALL = "all";

type Option = { label: string; value: string };

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  leave: "Leave",
  sick: "Sick",
  absent: "Absent",
};

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
}: {
  id: string;
  label: string;
  items: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field className="w-full sm:w-48">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onChange(next ?? ALL)}
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
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Location</span>
            <span>{locationLabel}</span>
          </div>
        )}

        <Field className="w-full sm:w-48">
          <FieldLabel htmlFor="attendance-date">Date</FieldLabel>
          <Input
            id="attendance-date"
            type="date"
            value={date}
            onChange={(event) => {
              // A cleared field has no date to push.
              if (event.target.value) setParam("date", event.target.value);
            }}
          />
          <FieldDescription>Follows {zone}.</FieldDescription>
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
        <Table className="min-w-[40rem]">
          <TableCaption className="sr-only">
            Attendance for {date}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Shift</TableHead>
              <TableHead>Work area</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const worker = data.workers[row.workerId];
              const shiftDefId = row.record?.shiftDefId ?? row.rosterShiftDefId;
              const workAreaId = row.record?.workAreaId ?? row.rosterWorkAreaId;
              return (
                <TableRow key={row.workerId}>
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
                    <StatusBadge row={row} />
                  </TableCell>
                  <TableCell>
                    {(shiftDefId && shiftLabels.get(shiftDefId)) || "None"}
                  </TableCell>
                  <TableCell>
                    {(workAreaId && areaNames.get(workAreaId)) || "None"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.state === "unscheduled" ? (
                        <Badge variant="outline">Unscheduled</Badge>
                      ) : null}
                      {row.shiftDiffers && row.rosterShiftDefId ? (
                        <>
                          <Badge variant="secondary">Shift differs</Badge>
                          <span className="text-muted-foreground">
                            Rostered: {shiftLabels.get(row.rosterShiftDefId)}
                          </span>
                        </>
                      ) : null}
                      {row.record?.reason ? (
                        <span className="text-muted-foreground">
                          {row.record.reason}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
