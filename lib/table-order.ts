import { asc, desc, type SQL, type SQLWrapper } from "drizzle-orm";

import type { TableSort } from "@/lib/table-params";

// Turns the parsed URL sorts into an ORDER BY list. Column ids are
// own-property checked against the page's whitelist — a plain truthiness
// guard would admit prototype-chain ids (e.g. `?sort=__proto__`), which
// drizzle rejects mid-render. Unknown or duplicate ids are dropped.
export function buildOrder(
  sorts: TableSort[],
  sortable: Record<string, SQLWrapper>,
  defaultOrder: SQL[],
): SQL[] {
  const ordered: SQL[] = [];
  const used = new Set<string>();
  for (const { columnId, dir } of sorts) {
    if (!Object.hasOwn(sortable, columnId) || used.has(columnId)) continue;
    used.add(columnId);
    const column = sortable[columnId];
    ordered.push(dir === "desc" ? desc(column) : asc(column));
  }
  // The default order always trails the user's sorts: it is the
  // deterministic tie-breaker that keeps pagination stable (epic #24).
  return [...ordered, ...defaultOrder];
}
