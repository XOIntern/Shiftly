"use client";

import { Fragment } from "react";
import { ChevronDownIcon, PaintBucketIcon, XIcon } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  AreaGroup,
  GridRow,
  GridValues,
} from "@/app/dashboard/requests/request-form";
import { dayTotals } from "@/app/dashboard/requests/totals-row";
import {
  DAYS,
  DayHeaders,
  RequestGridShell,
  STICKY_CELL,
} from "@/app/dashboard/requests/request-grid-shell";

// One added work area: a disclosure header with its per-day totals and a
// remove control, over the area's shift × position rows.
export function AreaSection({
  group,
  open,
  type,
  dates,
  values,
  quickFill,
  rows,
  fieldErrors,
  onToggle,
  onRemove,
  onCellChange,
  onQuickFillChange,
  onFillRow,
}: {
  group: AreaGroup;
  open: boolean;
  type: "weekly" | "daily";
  dates: string[];
  values: GridValues;
  quickFill: Record<string, string>;
  // Every row of the grid, in submit order: a row's index places the
  // action's `lines.<i>` refusals.
  rows: GridRow[];
  fieldErrors: Record<string, string>;
  onToggle: (workAreaId: string) => void;
  onRemove: (workAreaId: string) => void;
  onCellChange: (cellKey: string, raw: string) => void;
  onQuickFillChange: (rowKey: string, raw: string) => void;
  onFillRow: (row: GridRow) => void;
}) {
  const weekly = type === "weekly";
  // Columns per row: label, the dates, and (weekly) the "same all days"
  // tail.
  const columnCount = 1 + dates.length + (weekly ? 1 : 0);
  const totals = dayTotals(values, group.rows, dates);
  const areaWeek = totals.reduce((sum, n) => sum + n, 0);
  const bodyId = `request-area-${group.workAreaId}`;
  return (
    <section aria-labelledby={`${bodyId}-title`} className="rounded-md border">
      <div className="flex items-start gap-1 p-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-labelledby={`${bodyId}-title`}
          aria-describedby={`${bodyId}-totals`}
          onClick={() => onToggle(group.workAreaId)}
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
            <span
              id={`${bodyId}-totals`}
              className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums"
            >
              {weekly ? (
                <>
                  {DAYS.map((day, i) => (
                    <span key={day}>{`${day} ${totals[i] ?? 0}`}</span>
                  ))}
                  <span className="font-medium text-foreground">{`Week ${areaWeek}`}</span>
                </>
              ) : (
                <span>{`Total ${areaWeek}`}</span>
              )}
            </span>
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          aria-label={`Remove area ${group.workAreaName}`}
          onClick={() => onRemove(group.workAreaId)}
        >
          <XIcon />
        </Button>
      </div>
      <RequestGridShell
        dates={dates}
        tail={weekly}
        id={bodyId}
        hidden={!open}
        className="border-t"
      >
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
            <DayHeaders type={type} />
            {weekly ? (
              <th scope="col" className="px-2 py-2 text-center font-medium">
                Same all days
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => {
            // Best-effort per-line placement: the action's refusal keys are
            // lines-array indexes (`lines.<i>[.field]`), not grid
            // coordinates, so a row matching the index — if any — gets the
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
                            onCellChange(key, event.target.value)
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
                            onQuickFillChange(row.key, event.target.value)
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-10 md:size-8"
                          aria-label={`Fill every day ${label}`}
                          onClick={() => onFillRow(row)}
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
      </RequestGridShell>
    </section>
  );
}
