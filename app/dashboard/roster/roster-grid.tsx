"use client";

import { useState, useTransition } from "react";
import { EraserIcon } from "lucide-react";
import { toast } from "sonner";
import { Popover } from "@base-ui/react/popover";

import type { Violation } from "@/lib/engine/validate";
import { setAssignment } from "@/app/dashboard/roster/actions";
import type {
  SetAssignmentInput,
  SetAssignmentResult,
} from "@/app/dashboard/roster/actions";
import { GENERIC_ERROR } from "@/lib/action-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

// The weekly grid editor (roster-engine task 7): one work-area card, rows =
// the location's workers as ONE server slice (50/cell-page), columns
// Mon–Sun. A cell click opens a shift picker popover (NO drag-drop — an
// explicit product decision); the pick commits through setAssignment and
// the action's returned violations land as row badges plus a plan summary
// line. The pure helpers below are exported for the tests (bun test has no
// DOM, so the interactions are asserted through them).

export type RosterShiftOption = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
};

export type GridWorker = { id: string; employeeId: string };

// The disabled-generate explanation: null when the week's demand is
// covered (the button is enabled), the copy otherwise. Pinned by tests.
export function generateGateText(requirementCount: number): string | null {
  return requirementCount === 0 ? "No received requests cover this week." : null;
}

// A cell is keyed by worker + date; the card's area rides the request.
export function assignmentKey(workerId: string, date: string): string {
  return `${workerId}|${date}`;
}

export type PickOutcome = {
  ok: boolean;
  violations?: Violation[];
  message?: string;
};

// One cell pick, action-shaped. The set (upsert) carries the card's area —
// the assignment row is area-welded; the clear (delete) needs no area.
// `run` is injectable for tests; production uses the imported action.
export async function commitPick(
  input: SetAssignmentInput,
  run: (i: SetAssignmentInput) => Promise<SetAssignmentResult> = setAssignment,
): Promise<PickOutcome> {
  const payload: SetAssignmentInput =
    input.shiftDefId === null
      ? {
          planId: input.planId,
          workerId: input.workerId,
          date: input.date,
          shiftDefId: null,
        }
      : input;
  const result = await run(payload);
  if (!result.ok) {
    return { ok: false, message: result.message ?? GENERIC_ERROR };
  }
  return { ok: true, violations: result.data?.violations ?? [] };
}

// Violations grouped per worker — the row-badge source of truth.
export function violationsByWorker(
  violations: Violation[],
): Record<string, Violation[]> {
  const byWorker: Record<string, Violation[]> = {};
  for (const v of violations) {
    (byWorker[v.workerId] ??= []).push(v);
  }
  return byWorker;
}

export function badgeText(v: Violation): string {
  return `${v.rule} · ${v.message}`;
}

// The plan-level line under the grid: count + up to three quoted messages.
export function violationSummary(violations: Violation[]): string | null {
  if (violations.length === 0) return null;
  const head = violations
    .slice(0, 3)
    .map((v) => badgeText(v))
    .join("; ");
  return `${violations.length} rule warning${violations.length === 1 ? "" : "s"} — ${head}`;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function RosterGrid({
  planId,
  canEdit,
  readOnlyReason,
  workAreas,
  workAreaId,
  onWorkAreaChange,
  shifts,
  workers,
  dates,
  cells,
  rowPage,
  workerTotal,
  onRowPageChange,
}: {
  planId: string;
  // Admin + draft only: an ho and a published plan render static cells.
  canEdit: boolean;
  readOnlyReason: string;
  workAreas: { id: string; name: string }[];
  workAreaId: string;
  onWorkAreaChange: (id: string) => void;
  shifts: RosterShiftOption[];
  workers: GridWorker[];
  dates: string[];
  cells: Record<string, string>;
  rowPage: number;
  workerTotal: number;
  onRowPageChange: (page: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  // Violations from the latest edit: the action returns the FULL list, so
  // each pick replaces (never accumulates) the map and the summary.
  const [violations, setViolations] = useState<Violation[]>([]);
  const [openCell, setOpenCell] = useState<string | null>(null);

  const labelOf = new Map(shifts.map((s) => [s.id, s]));
  const rowBadges = violationsByWorker(violations);
  const summary = violationSummary(violations);

  const pageCount = Math.max(1, Math.ceil(workerTotal / 50));
  const first = (rowPage - 1) * 50 + 1;
  const last = Math.min(rowPage * 50, workerTotal);

  function pick(workerId: string, employeeId: string, date: string, shiftDefId: string | null) {
    setOpenCell(null);
    if (pending) return;
    startTransition(async () => {
      const outcome = await commitPick({
        planId,
        workAreaId,
        workerId,
        date,
        shiftDefId,
      });
      if (!outcome.ok) {
        toast.error(outcome.message ?? GENERIC_ERROR);
        return;
      }
      toast.success(
        shiftDefId === null
          ? `Assignment cleared for ${employeeId}.`
          : `Assignment saved for ${employeeId}.`,
      );
      setViolations(outcome.violations ?? []);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {workAreas.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Work area">
          {workAreas.map((area) => (
            <Button
              key={area.id}
              type="button"
              size="sm"
              variant={area.id === workAreaId ? "default" : "outline"}
              onClick={() => onWorkAreaChange(area.id)}
            >
              {area.name}
            </Button>
          ))}
        </div>
      ) : null}

      {!canEdit ? (
        <p className="text-sm text-muted-foreground">{readOnlyReason}</p>
      ) : null}
      {summary ? (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="status">
          {summary}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="min-w-[180px] px-3 py-2 text-start font-medium">
                Worker
              </th>
              {dates.map((date, index) => (
                <th
                  key={date}
                  className="w-20 px-2 py-2 text-center font-medium"
                >
                  <span className="block">{DAY_LABELS[index]}</span>
                  <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                    {date.slice(5)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workers.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="px-3 py-1.5">
                  <span className="block font-medium">{row.employeeId}</span>
                  {(rowBadges[row.id] ?? []).map((v) => (
                    <Badge
                      key={`${v.rule}${v.date ?? ""}${v.message}`}
                      variant="destructive"
                      title={v.message}
                    >
                      {badgeText(v)}
                    </Badge>
                  ))}
                </td>
                {dates.map((date) => {
                  const key = assignmentKey(row.id, date);
                  const shiftDefId = cells[key];
                  const shift = shiftDefId ? labelOf.get(shiftDefId) : undefined;
                  const cell = (
                    <span
                      className={cn(
                        "block rounded px-1 py-1 text-center text-xs",
                        shift && "bg-primary/10 font-medium",
                      )}
                    >
                      {shift ? (
                        <>
                          {shift.label}
                          <span className="block font-normal tabular-nums text-muted-foreground">
                            {shift.startTime}–{shift.endTime}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>
                  );
                  if (!canEdit) return <td key={date}>{cell}</td>;
                  return (
                    <td key={date} className="p-0.5">
                      <Popover.Root
                        open={openCell === key}
                        onOpenChange={(open) =>
                          setOpenCell(open ? key : null)
                        }
                      >
                        <Popover.Trigger
                          render={
                            <button
                              type="button"
                              className="w-full cursor-pointer rounded border border-transparent hover:border-border"
                              aria-label={`Open shift picker for ${row.employeeId} on ${date}`}
                              disabled={pending}
                            />
                          }
                        >
                          {cell}
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Positioner
                            className="isolate z-50 outline-none"
                            align="start"
                            sideOffset={4}
                          >
                            <Popover.Popup className="z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
                              {shift ? (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent"
                                  onClick={() => pick(row.id, row.employeeId, date, null)}
                                >
                                  <EraserIcon className="size-3.5" />
                                  Clear shift
                                </button>
                              ) : null}
                              {shifts.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  className={cn(
                                    "flex w-full flex-col rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent",
                                    option.id === shiftDefId && "bg-accent",
                                  )}
                                  onClick={() =>
                                    pick(row.id, row.employeeId, date, option.id)
                                  }
                                >
                                  {option.label}
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {option.startTime}–{option.endTime}
                                  </span>
                                </button>
                              ))}
                              {shifts.length === 0 ? (
                                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                  No active shifts at this location.
                                </p>
                              ) : null}
                            </Popover.Popup>
                          </Popover.Positioner>
                        </Popover.Portal>
                      </Popover.Root>
                    </td>
                  );
                })}
              </tr>
            ))}
            {workers.length === 0 ? (
              <tr>
                <td
                  colSpan={dates.length + 1}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No workers qualify for this work area.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="tabular-nums">
          {workerTotal > 0 ? `${first}–${last} of ${workerTotal} workers` : "0 workers"}
        </span>
        <span className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rowPage <= 1}
            onClick={() => onRowPageChange(rowPage - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rowPage >= pageCount}
            onClick={() => onRowPageChange(rowPage + 1)}
          >
            Next
          </Button>
        </span>
      </div>
    </div>
  );
}
