// Pure URL-param parsing for the server-driven master-data tables.
// Deliberately framework-free: server pages await searchParams with it and
// client components read useSearchParams with it (epic #24).

export const TABLE_PAGE_SIZE = 10;

export type SortDir = "asc" | "desc";
// null when the URL has no usable sort; whitelisting happens in the pages.
export type TableSort = { columnId: string; dir: SortDir } | null;

export type RawSearchParams = Record<string, string | string[] | undefined>;

// Single string values only: repeated params and undefined/empty fall back
// to defaults, so a malformed "?sort=a&sort=b" can never reach the queries.
export function parseTableSearchParams(raw: RawSearchParams): {
  q: string;
  page: number;
  sort: TableSort;
} {
  const first = (key: string): string | undefined => {
    const value = raw[key];
    const single = Array.isArray(value) ? value[0] : value;
    return single === "" ? undefined : single;
  };

  const q = (first("q") ?? "").trim();
  const parsedPage = Number.parseInt(first("page") ?? "", 10);
  const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const sortValue = first("sort");
  const sort: TableSort = sortValue
    ? { columnId: sortValue, dir: first("dir") === "desc" ? "desc" : "asc" }
    : null;

  return { q, page, sort };
}

// undefined for empty q; otherwise "%q%" with \, %, _ backslash-escaped so
// user input matches literally (never expands the wildcard).
export function ilikePattern(q: string): string | undefined {
  return q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : undefined;
}
