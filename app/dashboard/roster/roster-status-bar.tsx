"use client";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Trash2Icon,
} from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { toast } from "sonner";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import type { ActionState } from "@/types/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import { runExclusive } from "@/lib/run-exclusive";
import { dayFromNumber, dayNumber } from "@/lib/dates";
import { mondayOf } from "@/lib/week";
import {
  discardDraft,
  generateRoster,
  publishRoster,
  revisePlan,
} from "@/app/dashboard/roster/actions";
import type { RosterGate } from "@/app/dashboard/roster/roster-gate";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
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

// The discard confirmation's copy. Pure so tests can pin it: the dialog
// parts cannot render outside an open dialog.
export function discardDialogCopy(
  version: number,
  assignmentCount: number | null,
): { title: string; body: string } {
  const deleted =
    assignmentCount === null
      ? "Its assignments will be deleted."
      : `${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"} will be deleted.`;
  return {
    title: `Discard draft v${version}?`,
    body: `${deleted} Published versions are not affected.`,
  };
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
    canDiscard && planStatus === "draft" && selectedPlanId !== null;
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
          />
        </div>
        {showPrimary || showDiscard ? (
          <div className="flex min-w-0 max-w-full flex-col gap-1.5 sm:items-end">
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {showDiscard && selectedPlanId ? (
                <DiscardDraftButton
                  planId={selectedPlanId}
                  version={planVersion ?? 0}
                  assignmentCount={discardAssignmentCount}
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
              {showPrimary && gate.action === "publish" && selectedPlanId ? (
                <PublishButton
                  planId={selectedPlanId}
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

function DiscardDraftButton({
  planId,
  version,
  assignmentCount,
  onDiscarded,
}: {
  planId: string;
  version: number;
  assignmentCount: number | null;
  onDiscarded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Held here, not in the dialog content: the content unmounts on close,
  // this button stays mounted and guards a second submit.
  const lock = useRef(false);
  const copy = discardDialogCopy(version, assignmentCount);

  function discard() {
    startTransition(async () => {
      await runExclusive(lock, async () => {
        try {
          const result = await discardDraft(planId);
          if (result.ok) {
            toast.success("Draft discarded.");
            onDiscarded();
            return;
          }
          toast.error(result.message ?? GENERIC_ERROR);
        } catch {
          toast.error(GENERIC_ERROR);
        } finally {
          setOpen(false);
        }
      });
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="max-sm:h-10"
        disabled={pending}
        aria-busy={pending}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon data-icon="inline-start" />
        Discard draft
      </Button>
      <ConfirmDestructiveDialog
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        title={copy.title}
        body={copy.body}
        cancelLabel="Keep draft"
        confirmLabel="Discard draft"
        onConfirm={discard}
      />
    </>
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
  locationId,
  locationName,
}: {
  week: string;
  enabled: boolean;
  reason: string | null;
  reasonId: string;
  // The location the page resolved: the same one the gate counted.
  locationId: string | null;
  locationName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!locationId || pending) return;
    startTransition(async () => {
      const result = await generateRoster({
        weekStart: week,
        siteLocationId: locationId,
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            className="max-sm:h-10"
            disabled={!enabled || !locationId}
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
            Fills the week of {week}
            {locationName ? ` at ${locationName}` : ""} from its approved
            requests, validated against rules C1-C7. Publishing happens after
            review.
          </DialogDescription>
        </DialogHeader>
        {reason ? (
          <p className="text-sm text-muted-foreground">{reason}</p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !enabled || !locationId}
          >
            {pending ? "Generating…" : "Generate draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
