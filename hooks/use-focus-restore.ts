"use client";

import { useCallback, useEffect, useRef } from "react";

import { FOCUS_FALLBACK_SELECTOR } from "@/lib/final-focus";
import { restoreFocusTarget } from "@/lib/restore-focus";

// Runs after the dialog's own return-focus attempt (a microtask on unmount),
// and acts only if that attempt left focus on <body>.
function restoreFocusSoon(opener: HTMLElement | null) {
  setTimeout(() => {
    const active = document.activeElement;
    const target = restoreFocusTarget({
      activeIsBody: active === null || active === document.body,
      pending: false,
      opener,
      openerUsable:
        opener !== null && opener.isConnected && !opener.matches(":disabled"),
      fallback: document.querySelector<HTMLElement>(FOCUS_FALLBACK_SELECTOR),
    });
    target?.focus();
  }, 0);
}

// Puts focus back on a confirm dialog's opener once the owner's action
// settles. The dialog closes while `pending` still disables the opener, so
// its own return focus fails and focus drops to <body>. Call `arm()` for the
// outcomes that should end on the opener (a failure, a withdraw) and pass
// `onDialogClosed` to the dialog's `onCloseComplete`. Once the action has
// settled AND the dialog has finished closing, focus that is still on <body>
// goes to the opener, or to the page title if the opener is gone or stays
// disabled. An owner that unmounts while armed (a refresh removed it) sends
// focus to the page title.
export function useFocusRestore(pending: boolean) {
  const opener = useRef<HTMLButtonElement | null>(null);
  const armed = useRef(false);
  const settled = useRef(!pending);
  const closed = useRef(true);

  const restoreWhenReady = useCallback(() => {
    if (!armed.current || !settled.current || !closed.current) return;
    armed.current = false;
    restoreFocusSoon(opener.current);
  }, []);

  useEffect(() => {
    settled.current = !pending;
    restoreWhenReady();
  }, [pending, restoreWhenReady]);

  useEffect(
    () => () => {
      if (!armed.current) return;
      armed.current = false;
      restoreFocusSoon(null);
    },
    [],
  );

  // Called while the dialog is open: the restore waits for it to close.
  const arm = useCallback(() => {
    armed.current = true;
    closed.current = false;
  }, []);

  const onDialogClosed = useCallback(() => {
    closed.current = true;
    restoreWhenReady();
  }, [restoreWhenReady]);

  // `openerRef`: pass it as the opener's `ref`, or set it in the opener's
  // click handler.
  return { openerRef: opener, arm, onDialogClosed };
}
