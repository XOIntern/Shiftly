import { asc, count, desc, ilike } from "drizzle-orm";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  TABLE_PAGE_SIZE,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
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
}: PageProps<"/sites">) {
  await requireSuperadmin();
  const { q, page, sort } = parseTableSearchParams(await searchParams);
  const pattern = ilikePattern(q);
  const where = pattern ? ilike(site.name, pattern) : undefined;

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(site)
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / TABLE_PAGE_SIZE));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  const sites = await db
    .select({ id: site.id, name: site.name, isActive: site.isActive })
    .from(site)
    .where(where)
    .orderBy(
      ...(sort && SORTABLE[sort.columnId as keyof typeof SORTABLE]
        ? [
            sort.dir === "desc"
              ? desc(SORTABLE[sort.columnId as keyof typeof SORTABLE])
              : asc(SORTABLE[sort.columnId as keyof typeof SORTABLE]),
          ]
        : DEFAULT_ORDER),
    )
    .limit(TABLE_PAGE_SIZE)
    .offset((clamped - 1) * TABLE_PAGE_SIZE);

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
