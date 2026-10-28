import { and, asc, count, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireSuperadmin } from "@/lib/session";
import { parseSitesView } from "@/lib/sites-view";
import { Card, CardContent } from "@/components/ui/card";
import { CreateSiteButton } from "@/components/sites/site-form";
import { DeletedSitesTable } from "@/components/sites/deleted-sites-table";
import { SitesTable } from "@/components/sites/sites-table";

// Deliberate block: the page queries master data behind the superadmin session
// check, so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = { name: site.name, isActive: site.isActive };
const DEFAULT_ORDER = [asc(site.name)];
// The deleted view sorts by name or by when the site was deleted, newest
// deletion first by default.
const SORTABLE_DELETED = { name: site.name, deletedAt: site.deletedAt };
const DEFAULT_ORDER_DELETED = [desc(site.deletedAt)];

// The reference algorithm every master-data page follows (epic #24):
// validate URL state, count first for pageCount, clamp the page, then fetch
// exactly one page of rows.
export default async function SitesPage({
  searchParams,
}: PageProps<"/dashboard/sites">) {
  await requireSuperadmin();
  const params = await searchParams;
  // ?show=deleted picks the soft-deleted list; it is not part of the shared
  // table params, so it is read off the raw search params.
  const view = parseSitesView(params.show);
  const { q, status, page, sorts, pageSize } = parseTableSearchParams(
    params,
    PAGE_SIZE_OPTIONS,
  );
  const pattern = ilikePattern(q);
  const deletedView = view === "deleted";
  // Null-safe and(...) composes search + filters. The deletedAt predicate
  // splits the live list from the deleted one (soft-delete epic #40) and
  // feeds both the count and the listing — this one `where` serves both
  // queries below. The isActive filter belongs to the live list only.
  const where = and(
    deletedView ? isNotNull(site.deletedAt) : isNull(site.deletedAt),
    ...(pattern ? [ilike(site.name, pattern)] : []),
    ...(!deletedView && status ? [eq(site.isActive, status === "active")] : []),
  );
  // buildOrder own-property checks the whitelist: a plain truthiness guard
  // would admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = deletedView
    ? buildOrder(sorts, SORTABLE_DELETED, DEFAULT_ORDER_DELETED)
    : buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(site)
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  const rows = await db
    .select({
      id: site.id,
      name: site.name,
      isActive: site.isActive,
      deletedAt: site.deletedAt,
    })
    .from(site)
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset((clamped - 1) * pageSize);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Site master data. Locations hang off sites here, and queries are
            scoped at the data level.
          </p>
        </div>
        <CreateSiteButton />
      </div>
      <Card>
        <CardContent>
          {deletedView ? (
            <DeletedSitesTable
              sites={rows.map(({ id, name, deletedAt }) => ({
                id,
                name,
                deletedAt: (deletedAt as Date).toISOString(),
              }))}
              pageCount={pageCount}
              total={rowCount}
            />
          ) : (
            <SitesTable
              sites={rows.map(({ id, name, isActive }) => ({
                id,
                name,
                isActive,
              }))}
              pageCount={pageCount}
              total={rowCount}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
