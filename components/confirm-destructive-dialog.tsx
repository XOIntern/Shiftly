"use client";

import type { ComponentProps, ReactNode } from "react";
import { Loader2Icon } from "lucide-react";

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

// Whether a requested open-state change should be applied. While the action
// runs every request is ignored, so Escape or an outside click cannot close
// the dialog under a pending submit.
export function guardedOpenChange(pending: boolean, next: boolean): boolean {
  // `next` is deliberately ignored: the answer depends only on `pending`.
  void next;
  return !pending;
}

type ConfirmDestructiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  onConfirm: () => void;
  // Passed through to the popup; omitted, focus returns to the trigger.
  finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"];
};

// A controlled confirmation for an irreversible action. Render it outside any
// menu popup. The caller owns the in-flight lock and the transition: this
// content unmounts on close, the caller stays mounted. The confirm button is
// a plain button, not a closing part, so the dialog stays open and shows the
// spinner until the caller closes it.
export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  pending,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  finalFocus,
}: ConfirmDestructiveDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (guardedOpenChange(pending, next)) onOpenChange(next);
      }}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
