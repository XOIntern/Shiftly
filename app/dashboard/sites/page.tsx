import { asc, count, desc, ilike } from "drizzle-orm";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { PAGE_SIZE_OPTIONS, ilikePattern, parseTableSearchParams } from "@/lib/table-params";
import { requireSuperadmin } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreateSiteButton } from "@/components/site-form";
import { SitesTable } from "@/components/sites-table";

// Deliberate block: the page queries master data behind the superadmin session
// check, so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = { name: site.name, isActive: site.isActive };
const DEFAULT_ORDER = [asc(site.name)];

// The reference algorithm every master-data page follows (epic #24):
// validate URL state, count first for pageCount, clamp the page, then fetch
// exactly one page of rows.
export default async function SitesPage({
  searchParams,
}: PageProps<"/dashboard/sites">) {
  await requireSuperadmin();
  const { q, page, sort, pageSize } = parseTableSearchParams(
    await searchParams,
    PAGE_SIZE_OPTIONS,
  );
  const pattern = ilikePattern(q);
  const where = pattern ? ilike(site.name, pattern) : undefined;
  // Own-property lookup: a plain truthiness guard would admit prototype-chain
  // `columnIds` (e.g. `?sort=__proto__`), which drizzle rejects mid-render.
  const sortColumn =
    sort && Object.hasOwn(SORTABLE, sort.columnId)
      ? SORTABLE[sort.columnId as keyof typeof SORTABLE]
      : undefined;

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(site)
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  const sites = await db
    .select({ id: site.id, name: site.name, isActive: site.isActive })
    .from(site)
    .where(where)
    .orderBy(
      ...(sort && sortColumn
        ? [sort.dir === "desc" ? desc(sortColumn) : asc(sortColumn)]
        : DEFAULT_ORDER),
    )
    .limit(pageSize)
    .offset((clamped - 1) * pageSize);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Site master data. Locations hang off sites here, and queries are
            scoped at the data level.
          </p>
        </div>
        <CreateSiteButton />
      </div>
      <Card>
        <CardContent>
          <SitesTable sites={sites} pageCount={pageCount} total={rowCount} />
        </CardContent>
      </Card>
    </div>
  );
}
