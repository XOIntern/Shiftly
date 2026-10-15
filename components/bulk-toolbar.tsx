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
import type { ActionState } from "@/lib/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";

type BulkOperation = () => Promise<ActionState>;

// The toolbar strip DataTable renders while rows are selected. Wire a
// count, the two lifecycle verbs (activate/deactivate), and optionally a
// delete — which gets a confirm dialog since a bulk delete is not
// undoable. Every button runs its server action through one transition so
// the whole strip disables while a mutation is in flight.
export function BulkToolbar({
  entityName,
  count,
  clear,
  onActivate,
  onDeactivate,
  onDelete,
}: {
  entityName: string;
  count: number;
  clear: () => void;
  onActivate: BulkOperation;
  onDeactivate: BulkOperation;
  onDelete?: BulkOperation;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function run(operation: BulkOperation, verb: string) {
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) {
        toast.error(result.message ?? GENERIC_ERROR);
      } else {
        const skipped = result.blocked
          ? `, ${result.blocked} skipped`
          : "";
        toast.success(
          `${result.applied} ${entityName}${result.applied === 1 ? "" : "s"} ${verb}${skipped}`,
        );
      }
      // Whatever the rows' new state, the batch is spent — the refreshed
      // data no longer matches what the selection was made from.
      clear();
    });
  }

  const label = `${count} ${entityName}${count === 1 ? "" : "s"} selected`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground" data-selected-count>
        {label}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(onActivate, "activated")}
      >
        Activate
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(onDeactivate, "deactivated")}
      >
        Deactivate
      </Button>
      {onDelete ? (
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => setConfirmOpen(true)}
        >
          Delete
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={clear}
      >
        Clear
      </Button>
      {onDelete ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {count} {entityName}
                {count === 1 ? "" : "s"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the selected rows. Rows still
                referenced elsewhere are skipped, not deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  setConfirmOpen(false);
                  run(onDelete, "deleted");
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
