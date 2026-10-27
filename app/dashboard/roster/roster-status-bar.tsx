"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { Popover } from "@base-ui/react/popover";
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
import type { RosterGate } from "@/app/dashboard/roster/roster-gate";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// The roster page's control strip: the Monday-anchored week navigator, the
// location (picked, or the admin's pinned one), the plan version picker when
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

// Editing a published plan happens through the NEXT draft version: the
// guarded `revisePlan` action resolves the actor server-side (the clicking
// admin names the audit entry and the clone) and copies the published row
// into a draft; the UI navigates to it, leaving the published version
// untouched for attendance.
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

// The location the bar and the gate act on: an admin's pinned one, else the
// `locationId` URL pick when it is a location in scope, else the only
// location in scope, else none yet.
export function selectedLocationFor({
  pinnedLocationId,
  siteLocations,
  param,
}: {
  pinnedLocationId: string | undefined;
  siteLocations: SiteLocationOption[];
  param: string | null;
}): string | null {
  if (pinnedLocationId) return pinnedLocationId;
  if (param && siteLocations.some((l) => l.id === param)) return param;
  if (siteLocations.length === 1) return siteLocations[0].id;
  return null;
}

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
  isSuperadmin: boolean;
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  pinnedLocationName?: string;
  pinnedLocationId?: string;
  canWrite: boolean;
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
  isSuperadmin,
  sites,
  siteLocations,
  pinnedLocationName,
  pinnedLocationId,
  canWrite,
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

  const selectedLocationId = selectedLocationFor({
    pinnedLocationId,
    siteLocations,
    param: searchParams.get("locationId"),
  });

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

  const showLocationPicker = !pinnedLocationId && siteLocations.length > 1;
  const locationText =
    pinnedLocationName ??
    (siteLocations.length === 1 ? siteLocations[0].name : null);

  const showPrimary = canWrite && gate.action !== "none";
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
        ) : locationText ? (
          <p className="text-sm font-medium">
            <span className="sr-only">Location: </span>
            {locationText}
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

        {isPending ? (
          <span role="status" className="text-sm text-muted-foreground">
            Loading…
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <StatusText
          planStatus={planStatus}
          planVersion={planVersion}
          totals={totals}
          violationHead={violationHead}
          violationCount={violationCount}
        />
        {showPrimary ? (
          <div className="flex min-w-0 max-w-full flex-col gap-1.5 sm:items-end">
            {gate.action === "generate" ? (
              <GenerateDraftDialog
                key={selectedLocationId ?? "none"}
                week={week}
                enabled={gate.enabled}
                reason={reason}
                reasonId={reasonId}
                isSuperadmin={isSuperadmin}
                sites={sites}
                siteLocations={siteLocations}
                pinnedLocationName={pinnedLocationName}
                effectiveLocationId={selectedLocationId}
              />
            ) : null}
            {gate.action === "publish" && selectedPlanId ? (
              <PublishButton
                planId={selectedPlanId}
                enabled={gate.enabled}
                reasonId={reasonId}
              />
            ) : null}
            {gate.action === "revise" && selectedPlanId ? (
              <RevisePlanButton planId={selectedPlanId} />
            ) : null}
            {reason ? (
              <p
                id={reasonId}
                className="text-xs text-muted-foreground sm:text-end"
              >
                {reason}
                {gate.action === "generate" && !gate.enabled ? (
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
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatusText({
  planStatus,
  planVersion,
  totals,
  violationHead,
  violationCount,
}: {
  planStatus: "draft" | "published" | null;
  planVersion: number | null;
  totals: { required: number; filled: number } | null;
  violationHead: string[];
  violationCount: number;
}) {
  if (!planStatus) {
    return (
      <p className="text-sm text-muted-foreground">No plan for this week</p>
    );
  }

  const unlisted = violationCount - violationHead.length;

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
      {violationCount > 0 ? (
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
              {violationCount} warning{violationCount === 1 ? "" : "s"}
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

function PublishButton({
  planId,
  enabled,
  reasonId,
}: {
  planId: string;
  enabled: boolean;
  reasonId: string;
}) {
  const [pending, startTransition] = useTransition();

  function publish() {
    if (pending || !enabled) return;
    startTransition(async () => {
      const result: ActionState = await publishRoster(planId);
      if (result.ok) {
        toast.success("Roster published.");
        return;
      }
      // Refusals carry up to five violation messages: surfaced verbatim.
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <Button
      type="button"
      className="max-sm:h-10"
      onClick={publish}
      disabled={pending || !enabled}
      aria-describedby={enabled ? undefined : reasonId}
    >
      {pending ? "Publishing…" : "Publish roster"}
    </Button>
  );
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
      className="max-sm:h-10"
      onClick={revise}
      disabled={pending}
    >
      {pending ? "Revising…" : "Revise plan"}
    </Button>
  );
}

function GenerateDraftDialog({
  week,
  enabled,
  reason,
  reasonId,
  isSuperadmin,
  sites,
  siteLocations,
  pinnedLocationName,
  effectiveLocationId: barLocationId,
}: {
  week: string;
  enabled: boolean;
  reason: string | null;
  reasonId: string;
  isSuperadmin: boolean;
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  pinnedLocationName?: string;
  // The location the bar acts on; a superadmin may still change it here.
  effectiveLocationId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(barLocationId);
  const [pending, startTransition] = useTransition();

  // An admin is pinned server-side; a superadmin's pick lives in the dialog.
  const effectiveLocationId = isSuperadmin ? locationId : barLocationId;
  const locationOptions = isSuperadmin
    ? siteId === null
      ? siteLocations
      : siteLocations.filter((option) => option.siteId === siteId)
    : siteLocations;
  // Fresh object literals fall into base-ui Select's `items` excess-property
  // checks, so the entries ride typed variables instead.
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            className="max-sm:h-10"
            disabled={!enabled}
            aria-describedby={enabled ? undefined : reasonId}
          />
        }
      >
        <CalendarPlusIcon data-icon="inline-start" />
        Generate draft
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate draft roster</DialogTitle>
          <DialogDescription>
            Fills the week of {week} from its approved requests, validated
            against rules C1-C7. Publishing happens after review.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {isSuperadmin ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          {reason ? (
            <p className="text-sm text-muted-foreground">{reason}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !enabled || !effectiveLocationId}
          >
            {pending ? "Generating…" : "Generate draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
