"use client";

import { useState, useTransition } from "react";
import type { ReactNode } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActionState } from "@/lib/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";

type BulkOperation = () => Promise<ActionState>;

// The toolbar strip DataTable renders while rows are selected. Wire a
// count, the two lifecycle verbs (activate/deactivate), and optionally a
// delete. Every verb confirms through one AlertDialog before running —
// a deactivate signs workers out of their roster place and a bulk
// delete is not undoable. Lifecycle buttons hide when they cannot change
// anything: an all-Active selection needs Deactivate only, an
// all-Inactive one needs Activate only, and unknown status keeps both
// (old behavior). A mixed selection (some active, some inactive) keeps
// both visible but disabled — either verb would only half-apply — and a
// tooltip tells the operator to narrow the selection to one status.
// Delete is a post-deactivation verb: it hides while any selected row is
// still active and shows for an all-Inactive selection — or when status
// is unknown (same back-compat rule). Every confirm runs its server
// action through one transition so the whole strip disables while a
// mutation is in flight.
type Confirm = { operation: BulkOperation; verb: string } | null;

export function BulkToolbar({
  entityName,
  count,
  clear,
  onActivate,
  onDeactivate,
  onDelete,
  selectedStatuses,
}: {
  entityName: string;
  count: number;
  clear: () => void;
  onActivate: BulkOperation;
  onDeactivate: BulkOperation;
  onDelete?: BulkOperation;
  /** Per-selected-row isActive; omit when the table cannot supply it. */
  selectedStatuses?: boolean[];
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm>(null);

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
  const plural = count === 1 ? "" : "s";

  // A uniform selection has only one meaningful lifecycle direction.
  const statuses = selectedStatuses ?? [];
  const uniformInactive =
    statuses.length > 0 && statuses.every((status) => !status);
  const uniformActive =
    statuses.length > 0 && statuses.every((status) => status);
  // A mixed selection can only half-apply either verb, so both sit
  // disabled behind a tooltip; the operator narrows to a single status
  // to bulk-toggle.
  const mixed =
    statuses.length > 0 &&
    statuses.some(Boolean) &&
    statuses.some((status) => !status);
  // Delete is a post-deactivation verb: hide it while any selected row is
  // still active; unknown status keeps it (same back-compat rule as above).
  const deleteVisible =
    onDelete !== undefined &&
    (statuses.length === 0 || statuses.every((status) => !status));

  const confirmTitle = confirm
    ? `${confirm.verb[0].toUpperCase()}${confirm.verb.slice(1)} ${count} ${entityName}${plural}?`
    : "";

  const confirmDescription = confirm
    ? confirm.verb === "delete"
      ? "This permanently removes the selected rows. Rows still referenced elsewhere are skipped, not deleted."
      : "The selected rows will be set inactive. Anything that runs off them stops; re-activating restores it."
    : "";

  const activate = (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || mixed}
      onClick={() => setConfirm({ operation: onActivate, verb: "activate" })}
    >
      Activate
    </Button>
  );

  const deactivate = (
    <Button
      size="sm"
      variant="destructive"
      disabled={pending || mixed}
      onClick={() =>
        setConfirm({ operation: onDeactivate, verb: "deactivate" })
      }
    >
      Deactivate
    </Button>
  );

  // A disabled <button> fires no pointer events, so the tooltip trigger
  // is a span wrapping it (the shadcn disabled-button pattern; Base UI
  // tooltips work standalone, no provider needed).
  const withMixedTooltip = (button: ReactNode) => (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-block w-fit" />}>
        {button}
      </TooltipTrigger>
      <TooltipContent>
        Selection has mixed statuses — select rows with a single status to
        bulk-toggle.
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground" data-selected-count>
        {label}
      </span>
      {!uniformActive ? (mixed ? withMixedTooltip(activate) : activate) : null}
      {!uniformInactive ? (
        mixed ? (
          withMixedTooltip(deactivate)
        ) : (
          deactivate
        )
      ) : null}
      {deleteVisible ? (
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => setConfirm({ operation: onDelete, verb: "delete" })}
        >
          Delete
        </Button>
      ) : null}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.verb === "activate" ? "outline" : "destructive"}
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (!confirm) return;
                const { operation, verb } = confirm;
                setConfirm(null);
                run(operation, verb);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
