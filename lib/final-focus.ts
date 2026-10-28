// Where a confirmation dialog sends focus when it closes. After a successful
// action the trigger may be gone (the row left the list, the draft was
// discarded), so focus moves to the page's fallback element instead of
// dropping to <body>. Anything else, including a missing fallback, returns
// `true`: the dialog's default, back to the trigger.
export function finalFocusTarget(
  succeeded: boolean,
  fallback: HTMLElement | null,
): HTMLElement | true {
  return succeeded && fallback ? fallback : true;
}

export const FOCUS_FALLBACK_SELECTOR = "[data-focus-fallback]";

// `finalFocusTarget` against the page's fallback element, looked up when the
// dialog closes. Call it from inside the `finalFocus` callback, so the flag
// is read at close time: `finalFocus={() => focusFallbackTarget(ref.current)}`.
// (A helper that took the ref and returned the callback would pass a ref
// during render, which the React lint rules reject.)
export function focusFallbackTarget(succeeded: boolean): HTMLElement | true {
  return finalFocusTarget(
    succeeded,
    document.querySelector<HTMLElement>(FOCUS_FALLBACK_SELECTOR),
  );
}
