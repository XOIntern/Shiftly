"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { ActionState } from "@/types/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import { focusFallbackTarget } from "@/lib/final-focus";
import { shouldRefreshAfter } from "@/lib/refresh-after";
import { runExclusive } from "@/lib/run-exclusive";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import {
  discardDraft,
  generateRoster,
  publishRoster,
  revisePlan,
} from "@/app/dashboard/roster/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
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

// The roster status bar's action buttons: publish, revise, generate a draft
// and discard a draft. Each one owns its own pending state and toasts; the
// bar decides which of them to show.

// Editing a published plan happens through the NEXT draft version: the
// guarded `revisePlan` action resolves the actor server-side (the clicking
// admin names the audit entry and the clone) and copies the published row
// into a draft; the UI navigates to it, leaving the published version
// untouched for attendance.
// `thrown` marks a failure that came from a thrown error (a network or
// server failure) rather than one the action returned.
export type ReviseOutcome =
  | { ok: true; draftPlanId: string }
  | { ok: false; message: string; thrown?: boolean };

export async function commitRevise(
  planId: string,
  run: (id: string) => Promise<ReviseOutcome> = revisePlan,
): Promise<ReviseOutcome> {
  try {
    return await run(planId);
  } catch {
    return { ok: false, message: GENERIC_ERROR, thrown: true };
  }
}

// Only a failure the action returned can mean a stale plan; a thrown one is a
// network failure, where a refresh cannot help and breaks offline.
export function shouldRefreshAfterRevise(outcome: ReviseOutcome): boolean {
  return shouldRefreshAfter(outcome) && !(!outcome.ok && outcome.thrown);
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

// The publish confirmation's copy. Pure so tests can pin it: the dialog
// parts cannot render outside an open dialog. A shortfall is named so the
// admin publishes a short roster knowingly.
export function publishDialogCopy(
  version: number,
  totals: { required: number; filled: number } | null,
): { title: string; body: string } {
  const body = `This locks v${version} and marks the week's approved requests fulfilled. Use Revise to change it afterwards.`;
  const unfilled = totals ? totals.required - totals.filled : 0;
  const short =
    unfilled > 0
      ? unfilled === 1
        ? " 1 slot is still unfilled."
        : ` ${unfilled} slots are still unfilled.`
      : "";
  return { title: `Publish v${version}?`, body: `${body}${short}` };
}

export function PublishButton({
  planId,
  version,
  totals,
  enabled,
  reasonId,
}: {
  planId: string;
  version: number;
  // The selected plan's coverage, for the shortfall sentence; null when
  // unknown.
  totals: { required: number; filled: number } | null;
  enabled: boolean;
  reasonId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Held here, not in the dialog content: the content unmounts on close,
  // this button stays mounted and guards a second submit.
  const lock = useRef(false);
  // True only when the dialog closes on a successful publish: this button
  // turns into Revise, so focus goes to the title.
  const succeeded = useRef(false);
  // After a failure the dialog closes while the refresh still disables this
  // button; focus comes back to it once that ends.
  const {
    openerRef,
    arm: armFocusRestore,
    onDialogClosed,
  } = useFocusRestore(pending);
  const copy = publishDialogCopy(version, totals);

  function publish() {
    if (!enabled) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await runExclusive(lock, async () => {
        try {
          const result: ActionState = await publishRoster(planId);
          if (result.ok) {
            toast.success("Roster published.");
            succeeded.current = true;
            return;
          }
          // Refusals carry up to five violation messages: surfaced verbatim.
          toast.error(result.message ?? GENERIC_ERROR);
          armFocusRestore();
          // The plan may have changed elsewhere: re-read it.
          if (shouldRefreshAfter(result)) router.refresh();
        } catch {
          // A thrown action is a network or server failure, not a stale
          // plan: a refresh would fail the same way (offline, it falls back
          // to a full page load and the toast is lost).
          toast.error(GENERIC_ERROR);
          armFocusRestore();
        } finally {
          setOpen(false);
        }
      });
    });
  }

  return (
    <>
      <Button
        ref={openerRef}
        type="button"
        className="max-sm:h-10"
        onClick={() => {
          succeeded.current = false;
          setOpen(true);
        }}
        disabled={pending || !enabled}
        aria-busy={pending}
        aria-describedby={enabled ? undefined : reasonId}
      >
        {pending ? "Publishing…" : "Publish roster"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        title={copy.title}
        body={copy.body}
        cancelLabel="Keep editing"
        confirmLabel="Publish"
        confirmVariant="default"
        onConfirm={publish}
        finalFocus={() => focusFallbackTarget(succeeded.current)}
        onCloseComplete={onDialogClosed}
      />
    </>
  );
}

export function DiscardDraftButton({
  planId,
  version,
  assignmentCount,
  navigating,
  onDiscarded,
}: {
  planId: string;
  version: number;
  assignmentCount: number | null;
  // A navigation is in flight (after a discard the URL push has not yet
  // committed): the trigger stays disabled so it cannot reopen the dialog on
  // a plan that no longer exists.
  navigating: boolean;
  onDiscarded: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Held here, not in the dialog content: the content unmounts on close,
  // this button stays mounted and guards a second submit.
  const lock = useRef(false);
  // True only when the dialog closes on a successful discard: the draft and
  // this trigger are about to leave the page, so focus goes to the title.
  const succeeded = useRef(false);
  // After a failure the dialog closes while the refresh still disables this
  // button; focus comes back to it (or to the title if it is gone).
  const {
    openerRef,
    arm: armFocusRestore,
    onDialogClosed,
  } = useFocusRestore(pending);
  const copy = discardDialogCopy(version, assignmentCount);

  function discard() {
    startTransition(async () => {
      await runExclusive(lock, async () => {
        try {
          const result = await discardDraft(planId);
          if (result.ok) {
            toast.success("Draft discarded.");
            succeeded.current = true;
            onDiscarded();
            return;
          }
          toast.error(result.message ?? GENERIC_ERROR);
          armFocusRestore();
          if (shouldRefreshAfter(result)) router.refresh();
        } catch {
          // Not a stale-plan signal: see PublishButton.
          toast.error(GENERIC_ERROR);
          armFocusRestore();
        } finally {
          setOpen(false);
        }
      });
    });
  }

  return (
    <>
      <Button
        ref={openerRef}
        type="button"
        variant="outline"
        className="max-sm:h-10"
        disabled={pending || navigating}
        aria-busy={pending}
        onClick={() => {
          succeeded.current = false;
          setOpen(true);
        }}
      >
        <Trash2Icon data-icon="inline-start" />
        Discard draft
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        pending={pending}
        title={copy.title}
        body={copy.body}
        cancelLabel="Keep draft"
        confirmLabel="Discard draft"
        onConfirm={discard}
        finalFocus={() => focusFallbackTarget(succeeded.current)}
        onCloseComplete={onDialogClosed}
      />
    </>
  );
}

export function RevisePlanButton({ planId }: { planId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function revise() {
    if (pending) return;
    startTransition(async () => {
      try {
        const outcome = await commitRevise(planId);
        if (!outcome.ok) {
          toast.error(outcome.message);
          if (shouldRefreshAfterRevise(outcome)) router.refresh();
          return;
        }
        toast.success("Revision draft created.");
        router.push(
          `${pathname}?${buildReviseHref(searchParams.toString(), outcome.draftPlanId)}`,
          { scroll: false },
        );
      } catch {
        // commitRevise already folds a thrown action into a failure; this
        // catches anything else in the handler so it still toasts. No
        // refresh: a thrown error is not a stale-plan signal.
        toast.error(GENERIC_ERROR);
      }
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

export function GenerateDraftDialog({
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
