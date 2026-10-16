// Pure URL-param parsing for the server-driven master-data tables.
// Deliberately framework-free: server pages await searchParams with it and
// client components read useSearchParams with it (epic #24).

export const TABLE_PAGE_SIZE = 10;
// Rows-per-page choices the footer Select offers; the URL pageSize param
// accepts only these (anything else parses to the first option).
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

export type SortDir = "asc" | "desc";
// One sort key: a column id plus its direction. Whitelisting the column
// id happens per page (buildOrder), never here.
export type TableSort = { columnId: string; dir: SortDir };

// Multi-sort cap: three levels cover the real master-data needs without
// letting a crafted URL stack an unbounded ORDER BY.
export const MAX_SORTS = 3;

// Table status filters share this contract: lowercase tokens in the URL,
// anything else parses to null (no filter). Users pages can map role
// filters onto the same shape later.
export type StatusFilter = "active" | "inactive" | null;

export type RawSearchParams = Record<string, string | string[] | undefined>;

// Single string values only: repeated params and undefined/empty fall back
// to defaults, so a malformed "?sort=a&sort=b" can never reach the queries.
export function parseTableSearchParams(
  raw: RawSearchParams,
  pageSizeOptions: number[] = [TABLE_PAGE_SIZE],
): {
  q: string;
  page: number;
  sorts: TableSort[];
  status: StatusFilter;
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
  // Sort accepts two shapes: the multi form "a:asc,b:desc" and the legacy
  // single form "a" (+ optional dir). Both collapse into the same ordered
  // list; duplicate column ids keep their first occurrence.
  const sortValue = first("sort");
  const sorts: TableSort[] = [];
  if (sortValue) {
    for (const segment of sortValue.split(",")) {
      const [columnId, dirValue] = segment.split(":");
      if (!columnId || !columnId.trim()) continue;
      const column = columnId.trim();
      if (sorts.some((s) => s.columnId === column)) continue;
      sorts.push({ columnId: column, dir: dirValue === "desc" ? "desc" : "asc" });
      if (sorts.length === MAX_SORTS) break;
    }
    // The legacy "&dir=desc" only carries meaning when the sort value has
    // no explicit ":dir" pairs — never override one that was written.
    if (!sortValue.includes(":") && sorts.length === 1 && first("dir") === "desc") {
      sorts[0].dir = "desc";
    }
  }
  // Rows per page is whitelist-gated like sort column ids: only values the
  // UI offers are ever accepted; anything else falls to the first option.
  const parsedPageSize = Number.parseInt(first("pageSize") ?? "", 10);
  const defaultPageSize = pageSizeOptions[0] ?? TABLE_PAGE_SIZE;
  const pageSize = pageSizeOptions.includes(parsedPageSize)
    ? parsedPageSize
    : defaultPageSize;
  const statusValue = first("status");
  const status: StatusFilter =
    statusValue === "active" || statusValue === "inactive" ? statusValue : null;

  return { q, page, sorts, status, pageSize };
}

// undefined for empty q; otherwise "%q%" with \, %, _ backslash-escaped so
// user input matches literally (never expands the wildcard).
export function ilikePattern(q: string): string | undefined {
  return q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : undefined;
}
