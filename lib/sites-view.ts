export type SitesView = "active" | "deleted";

// Only the exact token selects the deleted view; a repeated or unknown value
// falls back to active, like the other URL whitelists (lib/table-params).
export function parseSitesView(
  raw: string | string[] | undefined,
): SitesView {
  return raw === "deleted" ? "deleted" : "active";
}
