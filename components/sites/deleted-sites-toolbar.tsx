"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { purgeBulk, restoreBulk } from "@/app/dashboard/sites/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { GENERIC_ERROR } from "@/lib/action-state";
import type { ActionState } from "@/types/action-state";

const noun = (count: number) => `site${count === 1 ? "" : "s"}`;

export type BulkSummary = {
  kind: "success" | "error";
  title: string;
  description?: string;
};

// What the toast says about a finished bulk action: the count that went
// through, and when some were skipped, why (the first refusal's message). A
// run where nothing went through reads as an error.
export function summarizeBulk(result: ActionState, verb: string): BulkSummary {
  if (!result.ok) {
    return { kind: "error", title: result.message ?? GENERIC_ERROR };
  }
  const applied = result.applied ?? 0;
  const blocked = result.blocked ?? 0;
  if (applied === 0 && blocked > 0) {
    return { kind: "error", title: result.message ?? GENERIC_ERROR };
  }
  if (blocked > 0) {
    return {
      kind: "success",
      title: `${applied} ${noun(applied)} ${verb}, ${blocked} skipped`,
      description: result.message,
    };
  }
  return { kind: "success", title: `${applied} ${noun(applied)} ${verb}` };
}

// What the confirm dialog tells the superadmin before the point of no return.
export function bulkPurgeDescription(count: number): string {
  return (
    `${count} ${noun(count)} will be deleted permanently and this cannot be ` +
    "undone. Their locations, work areas, positions, shifts, workers and " +
    "users are removed with them. A site with roster, request or audit " +
    "history is skipped."
  );
}

// The strip DataTable renders while deleted sites are selected. Restore runs
// at once (it can be undone by deleting again); permanent delete confirms.
// One transition keeps the whole strip disabled while a mutation is in
// flight, and the batch is spent afterwards, so the selection is cleared.
export function DeletedSitesToolbar({
  count,
  ids,
  clear,
}: {
  count: number;
  ids: string[];
  clear: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function run(operation: () => Promise<ActionState>, verb: string) {
    startTransition(async () => {
      const summary = summarizeBulk(await operation(), verb);
      if (summary.kind === "error") {
        toast.error(summary.title);
      } else {
        toast.success(summary.title, { description: summary.description });
      }
      clear();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {count} {noun(count)} selected
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => restoreBulk(ids), "restored")}
      >
        Restore
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
      >
        Delete permanently
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} {noun(count)} permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkPurgeDescription(count)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setConfirmOpen(false);
                run(() => purgeBulk(ids), "deleted permanently");
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
