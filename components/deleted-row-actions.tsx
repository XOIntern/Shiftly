"use client";

import { useState, useTransition } from "react";
import { EllipsisIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GENERIC_ERROR } from "@/lib/action-state";
import type { ActionState } from "@/types/action-state";

// The actions menu on a row of a deleted list. Permanent delete is offered
// only when canPurge is set: a page whose viewers may restore but never purge
// passes false and the entry (and its dialog) is not rendered at all.
export function DeletedRowActions({
  name,
  restore,
  purge,
  purgeDescription,
  purgeSuccess,
  canPurge,
}: {
  name: string;
  restore: () => Promise<ActionState>;
  purge: () => Promise<ActionState>;
  purgeDescription: string;
  purgeSuccess: string;
  canPurge: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Restore runs at once: deleting the row again undoes it.
  function handleRestore() {
    startTransition(async () => {
      const result = await restore();
      if (result.ok) {
        toast.success(`“${name}” restored`);
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={pending} onClick={handleRestore}>
            <RotateCcwIcon />
            Restore
          </DropdownMenuItem>
          {canPurge && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setOpen(true)}
            >
              <Trash2Icon />
              Delete permanently
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialog lives outside the menu popup so the menu can
      close before its layer opens. */}
      {canPurge && (
        <PurgeDialog
          purge={purge}
          purgeDescription={purgeDescription}
          purgeSuccess={purgeSuccess}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </DropdownMenu>
  );
}

function PurgeDialog({
  purge,
  purgeDescription,
  purgeSuccess,
  open,
  onOpenChange,
}: {
  purge: () => Promise<ActionState>;
  purgeDescription: string;
  purgeSuccess: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await purge();
      if (result.ok) {
        onOpenChange(false);
        toast.success(purgeSuccess);
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete permanently</AlertDialogTitle>
          <AlertDialogDescription>{purgeDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
