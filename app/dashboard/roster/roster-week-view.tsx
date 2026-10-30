"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import type { CoverageRow } from "@/lib/engine/coverage";
import type { RosterGate } from "@/app/dashboard/roster/roster-gate";
import { RequirementsPanel } from "@/app/dashboard/roster/requirements-panel";
import { DailyFillsList } from "@/app/dashboard/roster/daily-fills-list";
import type { DailyFillView } from "@/app/dashboard/roster/daily-fills-list";
import { RosterGrid } from "@/app/dashboard/roster/roster-grid";
import type {
  GridWorker,
  RosterShiftOption,
} from "@/app/dashboard/roster/roster-grid";
import { RosterStatusBar } from "@/app/dashboard/roster/roster-status-bar";
import type { RosterPlanOption } from "@/app/dashboard/roster/roster-status-bar";

// The roster page's client shell: the status bar (week navigator, location,
// plan picker, status and the one primary button) above the requirements
// panel and the grid of the selected work area. Everything it shows is
// computed server-side (gate, coverage, totals); this component only reads
// and pushes URL state, like the shared data-table pattern.

// Kept importable from here: the Revise wiring now lives in
// roster-plan-actions.tsx and is re-exported through the status bar.
export {
  buildReviseHref,
  commitRevise,
  shouldRefreshAfterRevise,
} from "@/app/dashboard/roster/roster-status-bar";
export type {
  ReviseOutcome,
  RosterPlanOption,
} from "@/app/dashboard/roster/roster-status-bar";

export type GridPlanView = {
  id: string;
  status: "draft" | "published";
  version: number;
  canEdit: boolean;
  readOnlyReason: string;
  shifts: RosterShiftOption[];
  workers: GridWorker[];
  workerTotal: number;
  rowPage: number;
  dates: string[];
  cells: Record<string, string>;
  dailyCells: Record<string, string>;
};

export type RequirementsView = {
  rows: CoverageRow[];
  areaNames: Record<string, string>;
  shiftLabels: Record<string, string>;
  positionNames: Record<string, string>;
};

export function RosterWeekView({
  week,
  canWrite,
  sites,
  siteLocations,
  locationId,
  plans,
  selectedPlanId,
  plan,
  dailyFills,
  gate,
  totals,
  violationHead,
  violationCount,
  blockingViolationCount,
  requirements,
  workAreaId,
  canDiscard,
  discardAssignmentCount,
}: {
  week: string;
  // Admin + superadmin; an ho never sees the write surface.
  canWrite: boolean;
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  // The location the page resolved (null only when none is in scope).
  locationId: string | null;
  plans: RosterPlanOption[];
  selectedPlanId: string | null;
  plan: GridPlanView | null;
  // The week's daily fills, listed instead of the grid when there is no plan.
  dailyFills: DailyFillView[];
  gate: RosterGate;
  totals: { required: number; filled: number } | null;
  violationHead: string[];
  violationCount: number;
  blockingViolationCount: number;
  requirements: RequirementsView;
  // The selected work area: the panel highlights it, the grid shows it.
  workAreaId: string;
  // Admin + superadmin on a selected draft; the server re-checks.
  canDiscard: boolean;
  // The selected plan's assignment rows (null without a plan).
  discardAssignmentCount: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const pushWith = (
    mutate: (params: URLSearchParams) => void,
    method: "push" | "replace" = "push",
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    startTransition(() => {
      const query = params.toString();
      router[method](`${pathname}${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    });
  };

  const setWorkArea = (id: string) => {
    pushWith((params) => {
      params.set("workAreaId", id);
      params.delete("rowPage");
    });
  };
  const setRowPage = (rowPage: number) => {
    pushWith((params) => {
      if (rowPage <= 1) params.delete("rowPage");
      else params.set("rowPage", String(rowPage));
    }, "replace");
  };

  const workAreaName =
    requirements.areaNames[workAreaId] ?? "Work area";

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="page-title" tabIndex={-1} data-focus-fallback>
          Roster
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Weekly drafts generated from approved manpower requests, validated
          against rules C1-C7 and published only when compliant. Unfilled
          demand stays visible per work area and shift.
        </p>
      </div>

      <RosterStatusBar
        week={week}
        gate={gate}
        plans={plans}
        selectedPlanId={selectedPlanId}
        planStatus={plan?.status ?? null}
        planVersion={plan?.version ?? null}
        totals={totals}
        violationHead={violationHead}
        violationCount={violationCount}
        blockingViolationCount={blockingViolationCount}
        sites={sites}
        siteLocations={siteLocations}
        selectedLocationId={locationId}
        navigating={isPending}
        canWrite={canWrite}
        canDiscard={canDiscard}
        discardAssignmentCount={discardAssignmentCount}
      />

      {/* Panel first in source order: it stacks above the grid on narrow
      screens and sits in the left column from lg up. */}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-2 lg:border-e lg:pe-4">
          <h2 className="text-sm font-medium">Requirements</h2>
          <RequirementsPanel
            rows={requirements.rows}
            areaNames={requirements.areaNames}
            shiftLabels={requirements.shiftLabels}
            positionNames={requirements.positionNames}
            selectedWorkAreaId={workAreaId}
            onSelectWorkArea={setWorkArea}
            canFill={canWrite}
            siteLocationId={locationId ?? ""}
            week={week}
          />
        </div>

        <div className="min-w-0">
          {plan ? (
            <RosterGrid
              planId={plan.id}
              canEdit={plan.canEdit}
              readOnlyReason={plan.readOnlyReason}
              workAreaId={workAreaId}
              workAreaName={workAreaName}
              shifts={plan.shifts}
              workers={plan.workers}
              dates={plan.dates}
              cells={plan.cells}
              dailyCells={plan.dailyCells}
              rowPage={plan.rowPage}
              workerTotal={plan.workerTotal}
              onRowPageChange={setRowPage}
            />
          ) : dailyFills.length > 0 ? (
            <DailyFillsList fills={dailyFills} />
          ) : (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              {!canWrite
                ? "No roster plan for this week."
                : requirements.rows.some((row) => row.source === "daily")
                  ? "No weekly roster for this week. Fill daily requests from the requirements panel."
                  : "No roster plan for this week yet. Generate a draft once a request is approved."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
