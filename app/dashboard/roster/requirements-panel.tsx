"use client";

import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";

import {
  AutoFillDailyButton,
  DailySlotMenu,
} from "@/app/dashboard/roster/daily-requests";
import { Badge } from "@/components/ui/badge";
import type { CoverageRow } from "@/lib/engine/coverage";
import { cn } from "@/lib/utils";

// The left-hand requirements panel of the roster page: one row per work area
// and shift with its week progress, the demanded positions and a warning when
// short. Progress is per area and shift only (an assignment carries no
// position); positions are the demanded breakdown. A weekly row selects its
// work area; a daily row is one dated slot offering replacement suggestions.

export type RequirementsPanelProps = {
  rows: CoverageRow[];
  areaNames: Record<string, string>;
  shiftLabels: Record<string, string>;
  positionNames: Record<string, string>;
  selectedWorkAreaId: string;
  onSelectWorkArea: (id: string) => void;
  canFill: boolean;
  siteLocationId: string;
  // The displayed week's Monday: what Auto-fill daily fills.
  week: string;
};

export function RequirementsPanel({
  rows,
  areaNames,
  shiftLabels,
  positionNames,
  selectedWorkAreaId,
  onSelectWorkArea,
  canFill,
  siteLocationId,
  week,
}: RequirementsPanelProps) {
  if (rows.length === 0) {
    return (
      <section aria-label="Requirements">
        <p className="text-sm text-muted-foreground">
          No approved requests for this week.{" "}
          <Link
            href="/dashboard/requests"
            className="inline-block rounded-sm py-1.5 font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Go to requests
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Requirements" className="flex min-w-0 flex-col gap-2">
      {canFill && rows.some((r) => r.source === "daily" && r.filled < r.required) ? (
        <div>
          <AutoFillDailyButton week={week} siteLocationId={siteLocationId} />
        </div>
      ) : null}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const title = `${areaNames[row.workAreaId] ?? "Work area"} · ${
            shiftLabels[row.shiftDefId] ?? "Shift"
          }`;
          const demanded = row.positions
            .map(
              (position) =>
                `${positionNames[position.positionId] ?? "Position"} ${position.headcount}`,
            )
            .join(" · ");
          const body = (
            <RowBody
              title={title}
              demanded={demanded}
              required={row.required}
              filled={row.filled}
              tag={row.source === "daily" ? row.date : null}
            />
          );

          if (row.source === "weekly") {
            const selected = row.workAreaId === selectedWorkAreaId;
            return (
              <li key={row.key}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelectWorkArea(row.workAreaId)}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left outline-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected && "bg-primary/5 shadow-[inset_2px_0_0_0_var(--primary)]",
                  )}
                >
                  {body}
                </button>
              </li>
            );
          }

          return (
            <li key={row.key} className="flex flex-col gap-2 rounded-md px-3 py-2">
              {body}
              {canFill && row.filled < row.required ? (
                <div>
                  <DailySlotMenu
                    row={row}
                    positionNames={positionNames}
                    siteLocationId={siteLocationId}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RowBody({
  title,
  demanded,
  required,
  filled,
  tag,
}: {
  title: string;
  demanded: string;
  required: number;
  filled: number;
  tag: string | null;
}) {
  const shortBy = required - filled;

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-medium break-words">{title}</span>
        <span className="shrink-0 text-sm tabular-nums">
          {filled}/{required}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {tag ? <Badge variant="outline">daily · {tag}</Badge> : null}
        {shortBy > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlertIcon
              role="img"
              aria-label={`Short by ${shortBy}`}
              className="size-3.5"
            />
            {shortBy} short
          </span>
        ) : null}
      </span>
      <span className="text-xs break-words text-muted-foreground">{demanded}</span>
    </span>
  );
}
