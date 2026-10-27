"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarPlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { ActionState } from "@/types/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import { finalFocusTarget } from "@/lib/final-focus";
import { runExclusive } from "@/lib/run-exclusive";
import {
  discardDraft,
  generateRoster,
  publishRoster,
  revisePlan,
} from "@/app/dashboard/roster/actions";
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

// The roster status bar's action buttons: publish, revise, generate a draft
// and discard a draft. Each one owns its own pending state and toasts; the
// bar decides which of them to show.

// Editing a published plan happens through the NEXT draft version: the
// guarded `revisePlan` action resolves the actor server-side (the clicking
// admin names the audit entry and the clone) and copies the published row
// into a draft; the UI navigates to it, leaving the published version
// untouched for attendance.
export type ReviseOutcome =
  { ok: true; draftPlanId: string } | { ok: false; message: string };

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

export function PublishButton({
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

export function DiscardDraftButton({
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
  // True only when the dialog closes on a successful discard: the draft and
  // this trigger are about to leave the page, so focus goes to the title.
  const succeeded = useRef(false);
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
        onClick={() => {
          succeeded.current = false;
          setOpen(true);
        }}
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
        finalFocus={() =>
          finalFocusTarget(
            succeeded.current,
            document.querySelector<HTMLElement>("[data-focus-fallback]"),
          )
        }
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
