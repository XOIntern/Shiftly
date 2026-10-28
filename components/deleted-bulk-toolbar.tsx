"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { summarizeBulk } from "@/lib/bulk-summary";
import type { ActionState } from "@/types/action-state";

// The strip DataTable renders while deleted rows are selected. Restore runs
// at once (it can be undone by deleting again); permanent delete confirms,
// and is not offered at all unless canPurge is set. One transition keeps the
// whole strip disabled while a mutation is in flight, and the batch is spent
// afterwards, so the selection is cleared.
export function DeletedBulkToolbar({
  count,
  ids,
  clear,
  noun,
  restore,
  purge,
  bulkPurgeDescription,
  canPurge,
}: {
  count: number;
  ids: string[];
  clear: () => void;
  noun: (count: number) => string;
  restore: (ids: string[]) => Promise<ActionState>;
  purge: (ids: string[]) => Promise<ActionState>;
  bulkPurgeDescription: (count: number) => string;
  canPurge: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function run(operation: () => Promise<ActionState>, verb: string) {
    startTransition(async () => {
      const summary = summarizeBulk(await operation(), verb, noun);
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
        onClick={() => run(() => restore(ids), "restored")}
      >
        Restore
      </Button>
      {canPurge && (
        <>
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
                    run(() => purge(ids), "deleted permanently");
                  }}
                >
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
