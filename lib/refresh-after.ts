// A failed plan action (publish, revise, discard) usually means the plan
// changed in another tab: the view on screen is stale. The caller refreshes
// the route after ANY failure rather than matching on message text.
export function shouldRefreshAfter(result: { ok: boolean }): boolean {
  return !result.ok;
}
