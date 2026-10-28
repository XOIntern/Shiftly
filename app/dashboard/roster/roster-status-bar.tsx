"use client";

import { useId, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import { dayFromNumber, dayNumber } from "@/lib/dates";
import { mondayOf } from "@/lib/week";
import type { RosterGate } from "@/app/dashboard/roster/roster-gate";
import {
  DiscardDraftButton,
  GenerateDraftDialog,
  PublishButton,
  RevisePlanButton,
} from "@/app/dashboard/roster/roster-plan-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Kept importable from here: the plan action buttons live in their own module.
export {
  buildReviseHref,
  commitRevise,
  discardDialogCopy,
  publishDialogCopy,
  shouldRefreshAfterRevise,
} from "@/app/dashboard/roster/roster-plan-actions";
export type { ReviseOutcome } from "@/app/dashboard/roster/roster-plan-actions";

// The roster page's control strip: the Monday-anchored week navigator, the
// location (resolved by the page: a picker when several are in scope, else
// its name), the plan version picker when
// the week has more than one plan, a one-line status of the selected plan,
// and the page's single primary button. Which button, and whether it can be
// pressed, is decided upstream by rosterGate; this component only renders
// that decision and shows the reason as visible text. Navigation is URL
// state, like the shared data-table pattern.

export type RosterPlanOption = {
  id: string;
  status: "draft" | "published";
  version: number;
  locationName: string;
  siteName: string;
};

type BarProps = {
  week: string;
  gate: RosterGate;
  plans: RosterPlanOption[];
  selectedPlanId: string | null;
  planStatus: "draft" | "published" | null;
  planVersion: number | null;
  totals: { required: number; filled: number } | null;
  violationHead: string[];
  violationCount: number;
  // How many of violationCount block publishing (the rest is history).
  blockingViolationCount: number;
  sites: SiteOption[];
  // The locations in scope (an admin's is their one binding).
  siteLocations: SiteLocationOption[];
  // The location the page resolved; the gate and Generate act on it.
  selectedLocationId: string | null;
  // A navigation started outside the bar (work area, row page) is pending.
  navigating: boolean;
  canWrite: boolean;
  // May the actor discard the selected plan (admin/superadmin on a draft)?
  canDiscard: boolean;
  // The selected plan's assignment rows, for the discard dialog; null when
  // unknown.
  discardAssignmentCount: number | null;
};

const planLabel = (p: RosterPlanOption) =>
  `${p.status === "draft" ? "Draft" : "Published"} v${p.version} - ${p.locationName}`;

export function RosterStatusBar({
  week,
  gate,
  plans,
  selectedPlanId,
  planStatus,
  planVersion,
  totals,
  violationHead,
  violationCount,
  blockingViolationCount,
  sites,
  siteLocations,
  selectedLocationId,
  navigating,
  canWrite,
  canDiscard,
  discardAssignmentCount,
}: BarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const reasonId = useId();

  const pushWith = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    startTransition(() => {
      const query = params.toString();
      router.push(`${pathname}${query ? `?${query}` : ""}`, {
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
      // Keep the location the page resolved: without it, a week with no
      // plan would fall back to the first location by name.
      if (selectedLocationId && siteLocations.length > 1) {
        params.set("locationId", selectedLocationId);
      }
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
  const setLocation = (locationId: string) => {
    pushWith((params) => {
      params.set("locationId", locationId);
      params.delete("planId");
      params.delete("workAreaId");
      params.delete("rowPage");
    });
  };

  const siteNameById = new Map(sites.map((s) => [s.id, s.name]));
  const locationItems: { label: string; value: string }[] = siteLocations.map(
    (l) => {
      const siteName = sites.length > 1 ? siteNameById.get(l.siteId) : null;
      return {
        label: siteName ? `${siteName} / ${l.name}` : l.name,
        value: l.id,
      };
    },
  );
  const planItems: { label: string; value: string }[] = plans.map((p) => ({
    label: planLabel(p),
    value: p.id,
  }));

  const showLocationPicker = siteLocations.length > 1;
  const locationName =
    siteLocations.find((l) => l.id === selectedLocationId)?.name ?? null;

  // After a discard the plan is gone: drop it from the URL so the page falls
  // back to the week's remaining plan or its empty state.
  const afterDiscard = () => {
    pushWith((params) => {
      params.delete("planId");
      params.delete("workAreaId");
      params.delete("rowPage");
    });
  };

  const showPrimary = canWrite && gate.action !== "none";
  const showDiscard =
    canDiscard &&
    planStatus === "draft" &&
    selectedPlanId !== null &&
    planVersion !== null;
  const reason = gate.action === "none" ? null : gate.reason;

  return (
    <section
      aria-label="Roster status"
      className="flex flex-col gap-3 border-b pb-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="max-sm:size-10"
            aria-label="Previous week"
            onClick={() => shiftWeek(-7)}
          >
            <ChevronLeftIcon />
          </Button>
          <Input
            type="date"
            aria-label="Week start"
            className="w-40 max-sm:h-10"
            value={week}
            onChange={(event) => changeWeek(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="max-sm:size-10"
            aria-label="Next week"
            onClick={() => shiftWeek(7)}
          >
            <ChevronRightIcon />
          </Button>
        </div>

        {showLocationPicker ? (
          <Select
            items={locationItems}
            value={selectedLocationId}
            onValueChange={(next) => {
              if (next) setLocation(next);
            }}
          >
            <SelectTrigger
              aria-label="Location"
              className="w-56 max-w-full max-sm:h-10"
            >
              <SelectValue placeholder="Select a location" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {locationItems.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : locationName ? (
          <p className="text-sm font-medium">
            <span className="sr-only">Location: </span>
            {locationName}
          </p>
        ) : null}

        {plans.length > 1 ? (
          <Select
            items={planItems}
            value={selectedPlanId}
            onValueChange={(next) => {
              if (next) setPlan(next);
            }}
          >
            <SelectTrigger
              aria-label="Roster plan"
              className="w-64 max-w-full max-sm:h-10"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {planItems.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}

        {/* The page's one loading announcer: always mounted so a screen
        reader hears it fill, whichever control started the navigation. */}
        <span role="status" className="text-sm text-muted-foreground">
          {isPending || navigating ? "Loading…" : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div aria-live="polite" className="min-w-0">
          <StatusText
            planStatus={planStatus}
            planVersion={planVersion}
            totals={totals}
            violationHead={violationHead}
            violationCount={violationCount}
            blockingViolationCount={blockingViolationCount}
          />
        </div>
        {showPrimary || showDiscard ? (
          <div className="flex min-w-0 max-w-full flex-col gap-1.5 sm:items-end">
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {showDiscard && selectedPlanId && planVersion !== null ? (
                <DiscardDraftButton
                  planId={selectedPlanId}
                  version={planVersion}
                  assignmentCount={discardAssignmentCount}
                  navigating={navigating || isPending}
                  onDiscarded={afterDiscard}
                />
              ) : null}
              {showPrimary && gate.action === "generate" ? (
                <GenerateDraftDialog
                  key={selectedLocationId ?? "none"}
                  week={week}
                  enabled={gate.enabled}
                  reason={reason}
                  reasonId={reasonId}
                  locationId={selectedLocationId}
                  locationName={locationName}
                />
              ) : null}
              {showPrimary &&
              gate.action === "publish" &&
              selectedPlanId &&
              planVersion !== null ? (
                <PublishButton
                  planId={selectedPlanId}
                  version={planVersion}
                  totals={totals}
                  enabled={gate.enabled}
                  reasonId={reasonId}
                />
              ) : null}
              {showPrimary && gate.action === "revise" && selectedPlanId ? (
                <RevisePlanButton planId={selectedPlanId} />
              ) : null}
            </div>
            {/* Always mounted while a button shows, so a reason that
            appears after publish/revise/generate is announced. */}
            <p
              id={reasonId}
              aria-live="polite"
              className="text-xs text-muted-foreground sm:text-end"
            >
              {reason}
              {reason && gate.action === "generate" && !gate.enabled ? (
                <>
                  {" "}
                  <Link
                    href="/dashboard/requests"
                    className="inline-block rounded-sm py-1.5 font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Go to requests
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// The trigger label. Only a draft has a publish gate, so only a draft splits
// the warnings into blocking and historical ones.
export function warningsText(
  total: number,
  blocking: number,
  draft: boolean,
): string | null {
  if (total === 0) return null;
  const base = `${total} warning${total === 1 ? "" : "s"}`;
  if (!draft || blocking === total) return base;
  return blocking === 0
    ? `${base}, none blocking`
    : `${base}, ${blocking} blocking`;
}

function StatusText({
  planStatus,
  planVersion,
  totals,
  violationHead,
  violationCount,
  blockingViolationCount,
}: {
  planStatus: "draft" | "published" | null;
  planVersion: number | null;
  totals: { required: number; filled: number } | null;
  violationHead: string[];
  violationCount: number;
  blockingViolationCount: number;
}) {
  if (!planStatus) {
    return (
      <p className="text-sm text-muted-foreground">No plan for this week</p>
    );
  }

  const unlisted = violationCount - violationHead.length;
  const label = warningsText(
    violationCount,
    blockingViolationCount,
    planStatus === "draft",
  );
  const blockNote =
    planStatus !== "draft" || blockingViolationCount === violationCount
      ? null
      : blockingViolationCount === 0
        ? "None of these block publishing"
        : `${blockingViolationCount} of ${violationCount} block publishing`;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-medium">
        {planStatus === "draft" ? "Draft" : "Published"}
        {planVersion !== null ? ` v${planVersion}` : ""}
      </span>
      {totals ? (
        <>
          <Separator />
          <span className="text-muted-foreground">
            {totals.filled}/{totals.required} filled
          </span>
        </>
      ) : null}
      {label ? (
        <>
          <Separator />
          <Popover.Root>
            <Popover.Trigger
              render={
                <button
                  type="button"
                  className="rounded-sm py-1.5 text-muted-foreground underline decoration-dotted underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              }
            >
              {label}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                className="isolate z-50 outline-none"
                align="start"
                sideOffset={4}
              >
                <Popover.Popup className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
                  <Popover.Title className="mb-2 text-sm font-medium">
                    Rule warnings
                  </Popover.Title>
                  <ul className="flex flex-col gap-1.5 text-muted-foreground">
                    {blockNote ? (
                      <li className="font-medium text-foreground">
                        {blockNote}
                      </li>
                    ) : null}
                    {violationHead.map((message, index) => (
                      <li key={`${index}-${message}`}>{message}</li>
                    ))}
                    {unlisted > 0 ? <li>and {unlisted} more</li> : null}
                  </ul>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </>
      ) : null}
    </p>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-muted-foreground">
      {" · "}
    </span>
  );
}
