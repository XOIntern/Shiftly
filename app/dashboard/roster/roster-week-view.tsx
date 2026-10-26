"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import type { ActionState } from "@/types/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import { dayFromNumber, dayNumber } from "@/lib/dates";
import { mondayOf } from "@/lib/week";
import {
  generateRoster,
  publishRoster,
  revisePlan,
} from "@/app/dashboard/roster/actions";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyRequests } from "@/app/dashboard/roster/daily-requests";
import type { DailyLineRow } from "@/app/dashboard/roster/daily-requests";
import {
  RosterGrid,
  generateGateText,
} from "@/app/dashboard/roster/roster-grid";
import type {
  GridWorker,
  RosterShiftOption,
} from "@/app/dashboard/roster/roster-grid";

// The roster page's client shell (roster-engine task 7): the Monday-anchored
// week navigator, the plan picker, the generate dialog (superadmin picks a
// location; an admin is pinned server-side), the publish gate, and the
// grid/daily tabs. Grid rows and the daily list stay server-paginated —
// this component only reads and pushes URL state, like the shared
// data-table pattern.

export type RosterPlanOption = {
  id: string;
  status: "draft" | "published";
  version: number;
  locationName: string;
  siteName: string;
};

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

// Spec §6.4 copy-on-edit: editing a published plan happens through the NEXT
// draft version — the guarded `revisePlan` action resolves the actor
// server-side (the clicking admin names the audit entry and the clone) and
// copies the published row into a draft; the UI navigates to it, leaving
// the published version untouched for attendance.
export type ReviseOutcome =
  | { ok: true; draftPlanId: string }
  | { ok: false; message: string };

export async function commitRevise(
  planId: string,
  run: (id: string) => Promise<ReviseOutcome> = revisePlan,
): Promise<ReviseOutcome> {
  try {
    return await run(planId);
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

export function buildReviseHref(
  currentQuery: string,
  draftPlanId: string,
): string {
  const params = new URLSearchParams(currentQuery);
  params.set("planId", draftPlanId);
  return params.toString();
}

function RevisePlanButton({ planId }: { planId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function revise() {
    if (pending) return;
    startTransition(async () => {
      const outcome = await commitRevise(planId);
      if (!outcome.ok) {
        toast.error(outcome.message);
        return;
      }
      toast.success("Revision draft created.");
      router.push(
        `${pathname}?${buildReviseHref(searchParams.toString(), outcome.draftPlanId)}`,
        { scroll: false },
      );
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={revise}
      disabled={pending}
    >
      {pending ? "Revising…" : "Revise plan"}
    </Button>
  );
}

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
  // Received/processing weekly line counts per location id — the
  // generate gate's server-side truth.
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

  // Monday snap on every input (the request-form precedent): any picked day
  // lands on its week's Monday, never a mid-week anchor.
  const changeWeek = (next: string) => {
    if (!next) return;
    pushWith((params) => {
      params.set("week", mondayOf(next));
      params.delete("planId");
      params.delete("workAreaId");
      params.delete("rowPage");
    });
  };
  const shiftWeek = (days: number) => {
    changeWeek(dayFromNumber(dayNumber(week) + days));
  };

  const setPlan = (planId: string) => {
    pushWith((params) => {
      params.set("planId", planId);
      params.delete("workAreaId");
      params.delete("rowPage");
    });
  };
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Roster</h1>
          <p className="text-sm text-muted-foreground">
            Weekly drafts generated from client manpower requirements, validated
            against rules C1–C7, published only when compliant. Deficits stay
            explicit, never silently violated.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {canGenerate ? (
            <GenerateDraftDialog
              week={week}
              isSuperadmin={isSuperadmin}
              sites={sites}
              siteLocations={siteLocations}
              pinnedLocationName={pinnedLocationName}
              pinnedLocationId={pinnedLocationId}
              requirementsByLocation={requirementsByLocation}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Previous week"
          onClick={() => shiftWeek(-7)}
        >
          <ChevronLeftIcon />
        </Button>
        <Input
          type="date"
          aria-label="Week start"
          className="w-40"
          value={week}
          onChange={(event) => changeWeek(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Next week"
          onClick={() => shiftWeek(7)}
        >
          <ChevronRightIcon />
        </Button>
        {isPending ? (
          <span className="text-sm text-muted-foreground">Loading…</span>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="grid">Weekly plan</TabsTrigger>
          <TabsTrigger value="daily">Daily requests</TabsTrigger>
        </TabsList>

        <TabsContent value="grid">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-64 items-center gap-2">
                <Select
                  items={plans.map((p) => ({
                    value: p.id,
                    label: `${p.status === "draft" ? "Draft" : "Published"} v${p.version} — ${p.locationName}`,
                  }))}
                  value={selectedPlanId}
                  onValueChange={(next) => {
                    if (next) setPlan(next);
                  }}
                >
                  <SelectTrigger aria-label="Roster plan" className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.status === "draft" ? "Draft" : "Published"} v
                          {p.version} — {p.locationName}
                        </SelectItem>
                      ))}
                      {plans.length === 0 ? (
                        <SelectItem value="none" disabled>
                          No plans for this week
                        </SelectItem>
                      ) : null}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {canGenerate && plan ? (
                <PublishBlock
                  planId={plan.id}
                  status={plan.status}
                  violationCount={plan.violationCount}
                  violationHead={plan.violationHead}
                  deficitCount={plan.deficitCount}
                />
              ) : null}
              {plan && plan.status === "published" && canGenerate ? (
                <RevisePlanButton planId={plan.id} />
              ) : null}
              {plan && plan.status === "published" && !canGenerate ? (
                <Badge variant="secondary">Published v{plan.version}</Badge>
              ) : null}
            </div>

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
                  ? "No roster plan for this week yet — generate a draft once requests arrive."
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

function PublishBlock({
  planId,
  status,
  violationCount,
  violationHead,
  deficitCount,
}: {
  planId: string;
  status: "draft" | "published";
  violationCount: number;
  violationHead: string[];
  deficitCount: number;
}) {
  const [pending, startTransition] = useTransition();

  if (status !== "draft") {
    return <Badge variant="secondary">Published</Badge>;
  }

  function publish() {
    if (pending) return;
    startTransition(async () => {
      const result: ActionState = await publishRoster(planId);
      if (result.ok) {
        toast.success("Roster published.");
        return;
      }
      // Refusals carry up to five violation messages — surface verbatim.
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" onClick={publish} disabled={pending}>
        {pending ? "Publishing…" : "Publish roster"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {violationCount === 0
          ? "No rule warnings."
          : `${violationCount} rule warning${violationCount === 1 ? "" : "s"}`}
        {violationHead.length > 0 ? ` — ${violationHead.join("; ")}` : ""}
        {` · ${deficitCount} unfilled slot${deficitCount === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}

function GenerateDraftDialog({
  week,
  isSuperadmin,
  sites,
  siteLocations,
  pinnedLocationName,
  pinnedLocationId,
  requirementsByLocation,
}: {
  week: string;
  isSuperadmin: boolean;
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  pinnedLocationName?: string;
  pinnedLocationId?: string;
  requirementsByLocation: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(
    pinnedLocationId ?? null,
  );
  const [pending, startTransition] = useTransition();

  // The location decides the gate: a superadmin picks first, an admin's
  // binding is preloaded.
  const effectiveLocationId = isSuperadmin
    ? (locationId ?? undefined)
    : pinnedLocationId;
  const gate = generateGateText(
    effectiveLocationId
      ? (requirementsByLocation[effectiveLocationId] ?? 0)
      : 0,
  );
  const locationOptions = isSuperadmin
    ? siteId === null
      ? siteLocations
      : siteLocations.filter((option) => option.siteId === siteId)
    : siteLocations;
  // Fresh object literals fall into base-ui Select's `items` excess-property
  // checks — the entries ride typed variables instead.
  const siteItems: { label: string; value: string }[] = isSuperadmin
    ? [
        { label: "All sites", value: "__all" },
        ...sites.map((s) => ({ label: s.name, value: s.id })),
      ]
    : [];
  const locationItems: { label: string; value: string }[] = locationOptions.map(
    (l) => ({ label: l.name, value: l.id }),
  );

  function submit() {
    if (!effectiveLocationId || pending) return;
    startTransition(async () => {
      const result = await generateRoster({
        weekStart: week,
        siteLocationId: effectiveLocationId,
      });
      if (result.ok) {
        toast.success("Draft roster generated.");
        setOpen(false);
        return;
      }
      toast.error(
        result.message ??
          (result.fieldErrors
            ? Object.values(result.fieldErrors).join(" · ")
            : GENERIC_ERROR),
      );
    });
  }

  const showSiteSelect = isSuperadmin && sites.length > 1;

  return (
    <div className="flex flex-col items-end gap-1">
      {/* The dead-week explanation lives OUTSIDE the dialog (its portal
      content does not exist while closed) so the page explains the disabled
      step without an interaction. */}
      {!isSuperadmin && gate ? (
        <p className="max-w-56 text-end text-xs text-muted-foreground">
          {gate}
        </p>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            // An admin's gate is known at page load — a dead week disables the
            // trigger right away; a superadmin's pick happens in the dialog.
            <Button disabled={!isSuperadmin && !!gate} />
          }
        >
          <CalendarPlusIcon data-icon="inline-start" />
          Generate draft
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate draft roster</DialogTitle>
            <DialogDescription>
              Fills the week of {week} from its received requests, validated
              against rules C1–C7. Publishing happens after review.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {isSuperadmin ? (
              <div className="grid grid-cols-2 gap-3">
                {showSiteSelect ? (
                  <Select
                    items={siteItems}
                    value={siteId}
                    onValueChange={(next) => {
                      setLocationId(null);
                      setSiteId(next === "__all" ? null : (next ?? null));
                    }}
                  >
                    <SelectTrigger aria-label="Site" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {siteItems.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : null}
                <Select
                  items={locationItems}
                  value={locationId}
                  onValueChange={(next) => {
                    if (next && next !== "__none") setLocationId(next);
                  }}
                >
                  <SelectTrigger aria-label="Location" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {locationId === null ? (
                        <SelectItem value="__none" disabled>
                          Select a location
                        </SelectItem>
                      ) : null}
                      {locationItems.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <Input
                value={pinnedLocationName ?? ""}
                disabled
                aria-label="Location"
              />
            )}
            {gate ? (
              <p className="text-sm text-muted-foreground">{gate}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || !!gate || !effectiveLocationId}
            >
              {pending ? "Generating…" : "Generate draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
