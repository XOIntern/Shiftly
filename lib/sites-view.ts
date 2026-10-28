export type SitesView = "active" | "deleted";

// Which list the sites page shows, from its raw ?status= param. Only the exact
// token selects the deleted list; a repeated or unknown value falls back to
// active, like the other URL whitelists (lib/table-params).
export function parseSitesView(
  raw: string | string[] | undefined,
): SitesView {
  return raw === "deleted" ? "deleted" : "active";
}
