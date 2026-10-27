"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyRequests } from "@/app/dashboard/roster/daily-requests";
import type { DailyLineRow } from "@/app/dashboard/roster/daily-requests";
import { rosterGate } from "@/app/dashboard/roster/roster-gate";
import { RosterGrid } from "@/app/dashboard/roster/roster-grid";
import type {
  GridWorker,
  RosterShiftOption,
} from "@/app/dashboard/roster/roster-grid";
import {
  RosterStatusBar,
  selectedLocationFor,
} from "@/app/dashboard/roster/roster-status-bar";
import type { RosterPlanOption } from "@/app/dashboard/roster/roster-status-bar";

// The roster page's client shell: the status bar (week navigator, location,
// plan picker, status and the one primary button) above the grid/daily tabs.
// Grid rows and the daily list stay server-paginated; this component only
// reads and pushes URL state, like the shared data-table pattern.

// Kept importable from here: the Revise wiring now lives with the status bar.
export { buildReviseHref, commitRevise } from "@/app/dashboard/roster/roster-status-bar";
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
  workAreas: { id: string; name: string }[];
  workAreaId: string;
  shifts: RosterShiftOption[];
  workers: GridWorker[];
  workerTotal: number;
  rowPage: number;
  dates: string[];
  cells: Record<string, string>;
  violationCount: number;
  violationHead: string[];
  deficitCount: number;
};

export function RosterWeekView({
  week,
  canGenerate,
  isSuperadmin,
  sites,
  siteLocations,
  pinnedLocationName,
  pinnedLocationId,
  requirementsByLocation,
  plans,
  selectedPlanId,
  plan,
  daily,
}: {
  week: string;
  // Admin + superadmin; an ho never sees the write surface.
  canGenerate: boolean;
  isSuperadmin: boolean;
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  // An admin's pinned location (their binding decides server-side).
  pinnedLocationName?: string;
  pinnedLocationId?: string;
  // Approved weekly line counts per location id: the generate gate's
  // server-side truth.
  requirementsByLocation: Record<string, number>;
  plans: RosterPlanOption[];
  selectedPlanId: string | null;
  plan: GridPlanView | null;
  daily: {
    lines: DailyLineRow[];
    pageCount: number;
    total: number;
    canFill: boolean;
    showLocation: boolean;
    showSite: boolean;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState("grid");

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

  // Interim gate inputs: the per-location approved line count is an imprecise
  // stand-in for both the approved request count and the slot count until the
  // page supplies the real numbers.
  const selectedLocationId = selectedLocationFor({
    pinnedLocationId,
    siteLocations,
    param: searchParams.get("locationId"),
  });
  const approvedCount = selectedLocationId
    ? (requirementsByLocation[selectedLocationId] ?? 0)
    : 0;
  const gate = rosterGate({
    canWrite: canGenerate,
    planStatus: plan?.status ?? null,
    approvedRequestCount: approvedCount,
    approvedSlotCount: approvedCount,
    blockingViolationCount: plan?.violationCount ?? 0,
  });

  const setWorkArea = (workAreaId: string) => {
    pushWith((params) => {
      params.set("workAreaId", workAreaId);
      params.delete("rowPage");
    });
  };
  const setRowPage = (rowPage: number) => {
    pushWith((params) => {
      if (rowPage <= 1) params.delete("rowPage");
      else params.set("rowPage", String(rowPage));
    }, "replace");
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="page-title">Roster</h1>
        <p className="text-sm text-muted-foreground">
          Weekly drafts generated from client manpower requirements, validated
          against rules C1–C7, published only when compliant. Deficits stay
          explicit, never silently violated.
        </p>
      </div>

      <RosterStatusBar
        week={week}
        gate={gate}
        plans={plans}
        selectedPlanId={selectedPlanId}
        planStatus={plan?.status ?? null}
        planVersion={plan?.version ?? null}
        totals={null}
        violationHead={plan?.violationHead ?? []}
        violationCount={plan?.violationCount ?? 0}
        isSuperadmin={isSuperadmin}
        sites={sites}
        siteLocations={siteLocations}
        pinnedLocationName={pinnedLocationName}
        pinnedLocationId={pinnedLocationId}
        canWrite={canGenerate}
      />

      {isPending ? (
        <span role="status" className="text-sm text-muted-foreground">
          Loading…
        </span>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="grid">Weekly plan</TabsTrigger>
          <TabsTrigger value="daily">Daily requests</TabsTrigger>
        </TabsList>

        <TabsContent value="grid">
          <div className="flex flex-col gap-4">
            {plan ? (
              <RosterGrid
                planId={plan.id}
                canEdit={plan.canEdit}
                readOnlyReason={plan.readOnlyReason}
                workAreas={plan.workAreas}
                workAreaId={plan.workAreaId}
                onWorkAreaChange={setWorkArea}
                shifts={plan.shifts}
                workers={plan.workers}
                dates={plan.dates}
                cells={plan.cells}
                rowPage={plan.rowPage}
                workerTotal={plan.workerTotal}
                onRowPageChange={setRowPage}
              />
            ) : (
              <p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
                {canGenerate
                  ? "No roster plan for this week yet. Generate a draft once a request is approved."
                  : "No roster plan for this week."}
              </p>
            )}
          </div>
        </TabsContent>

        {/* keepMounted: the daily list's SSR markup must exist server-side
        even while the grid tab is the active one. */}
        <TabsContent value="daily" keepMounted>
          <DailyRequests
            lines={daily.lines}
            pageCount={daily.pageCount}
            total={daily.total}
            canFill={daily.canFill}
            showLocation={daily.showLocation}
            showSite={daily.showSite}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
