export type ListView = "active" | "deleted";

// Which list a page shows, from its raw ?show= param. Only the exact token
// selects the deleted list; a repeated or unknown value falls back to
// active, like the other URL whitelists (lib/table-params).
export function parseListView(
  raw: string | string[] | undefined,
): ListView {
  return raw === "deleted" ? "deleted" : "active";
}

// The params after switching list: it restarts at page 1 and keeps the search
// term and the status filter (both lists filter by status). The sort belongs
// to the list being left (the deleted list has no status column to sort by),
// so it is dropped. Any value but "deleted" is the active list, whose URL
// carries no show param. Pure: the caller's params are left alone.
export function nextListParams(
  current: URLSearchParams,
  next: string | null,
): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  if (next === "deleted") {
    params.set("show", "deleted");
  } else {
    params.delete("show");
  }
  params.delete("sort");
  params.set("page", "1");
  return params;
}
