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

// The pending state of the dialog's buttons. `aria-disabled`, not the
// `disabled` attribute: a disabled button loses focus, and the focused
// confirm would drop focus to <body> for the whole request. The buttons stay
// focusable and announced as unavailable; clicks are ignored by
// `guardedConfirm` (confirm) and `guardedOpenChange` (cancel).
export function pendingButtonProps(pending: boolean): {
  "aria-disabled"?: true;
} {
  return pending ? { "aria-disabled": true } : {};
}

// Whether a confirm click should run the action: not while one is pending.
export function guardedConfirm(pending: boolean): boolean {
  return !pending;
}

// Looks disabled while `aria-disabled` is set, as the `disabled:` styles do.
const PENDING_BUTTON_CLASS =
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

export type ConfirmVariant = "destructive" | "default";

// The confirm button's style. Destructive unless the caller asks for the
// primary style: an action that is final but not destructive (approve,
// publish) still confirms, without the warning colour.
export function confirmButtonVariant(
  confirmVariant: ConfirmVariant | undefined,
): ConfirmVariant {
  return confirmVariant ?? "destructive";
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  onConfirm: () => void;
  // Omitted, the confirm button is destructive-styled.
  confirmVariant?: ConfirmVariant;
  // Passed through to the popup; omitted, Base UI returns focus to the
  // element that was focused before the dialog opened.
  finalFocus?: ComponentProps<typeof AlertDialogContent>["finalFocus"];
};

// A controlled confirmation for an irreversible action (destructive-styled
// unless `confirmVariant` says otherwise). Render it outside any
// menu popup. The caller owns the in-flight lock and the transition: this
// content unmounts on close, the caller stays mounted. The confirm button is
// a plain button, not a closing part, so the dialog stays open and shows the
// spinner until the caller closes it.
export function ConfirmDialog({
  open,
  onOpenChange,
  pending,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  confirmVariant,
  finalFocus,
}: ConfirmDialogProps) {
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
          <AlertDialogCancel
            {...pendingButtonProps(pending)}
            className={PENDING_BUTTON_CLASS}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={confirmButtonVariant(confirmVariant)}
            {...pendingButtonProps(pending)}
            className={PENDING_BUTTON_CLASS}
            aria-busy={pending}
            onClick={() => {
              if (guardedConfirm(pending)) onConfirm();
            }}
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
