// After a confirmed action that does not move focus on purpose (a withdraw,
// or any failure), the dialog tries to return focus to its opener while the
// opener is still disabled by the pending action, so focus drops to <body>.
// The owner checks again once the action settles.

// Whether focus should go back to the opener now: only when it fell to
// <body>, the action has settled and the opener is still on the page.
export function shouldRestoreFocus(
  activeIsBody: boolean,
  openerConnected: boolean,
  pending: boolean,
): boolean {
  return activeIsBody && openerConnected && !pending;
}

// Where to send focus once the action settles: the opener when it can take
// focus (on the page, not disabled), else the page's fallback element (the
// title). `null` leaves focus where it is: it is not on <body>, or the action
// is still pending.
export function restoreFocusTarget<T>({
  activeIsBody,
  pending,
  opener,
  openerUsable,
  fallback,
}: {
  activeIsBody: boolean;
  pending: boolean;
  opener: T | null;
  openerUsable: boolean;
  fallback: T | null;
}): T | null {
  if (!activeIsBody || pending) return null;
  if (opener && shouldRestoreFocus(activeIsBody, openerUsable, pending)) {
    return opener;
  }
  return fallback;
}
