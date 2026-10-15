// Pure URL-param parsing for the server-driven master-data tables.
// Deliberately framework-free: server pages await searchParams with it and
// client components read useSearchParams with it (epic #24).

export const TABLE_PAGE_SIZE = 10;
// Rows-per-page choices the footer Select offers; the URL pageSize param
// accepts only these (anything else parses to the first option).
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

export type SortDir = "asc" | "desc";
// null when the URL has no usable sort; whitelisting happens in the pages.
export type TableSort = { columnId: string; dir: SortDir } | null;

export type RawSearchParams = Record<string, string | string[] | undefined>;

// Single string values only: repeated params and undefined/empty fall back
// to defaults, so a malformed "?sort=a&sort=b" can never reach the queries.
export function parseTableSearchParams(
  raw: RawSearchParams,
  pageSizeOptions: number[] = [TABLE_PAGE_SIZE],
): {
  q: string;
  page: number;
  sort: TableSort;
  pageSize: number;
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
  // Rows per page is whitelist-gated like sort column ids: only values the
  // UI offers are ever accepted; anything else falls to the first option.
  const parsedPageSize = Number.parseInt(first("pageSize") ?? "", 10);
  const defaultPageSize = pageSizeOptions[0] ?? TABLE_PAGE_SIZE;
  const pageSize = pageSizeOptions.includes(parsedPageSize)
    ? parsedPageSize
    : defaultPageSize;

  return { q, page, sort, pageSize };
}

// undefined for empty q; otherwise "%q%" with \, %, _ backslash-escaped so
// user input matches literally (never expands the wildcard).
export function ilikePattern(q: string): string | undefined {
  return q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : undefined;
}
