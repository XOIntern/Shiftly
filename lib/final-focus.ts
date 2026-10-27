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
