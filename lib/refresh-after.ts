// A failed action that returned a result (a roster publish, revise or
// discard; a request approve or reject) usually means the record changed in
// another tab: the view on screen is stale. The caller refreshes the route
// after ANY returned failure rather than matching on message text. A thrown
// error is a network or server failure, not a stale view: no refresh.
export function shouldRefreshAfter(result: { ok: boolean }): boolean {
  return !result.ok;
}
