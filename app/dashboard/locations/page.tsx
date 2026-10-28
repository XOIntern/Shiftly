import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { parseListView } from "@/lib/list-view";
import { requireHO } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreateLocationButton } from "@/components/locations/location-form";
import type { SiteOption } from "@/types/site";
import { DeletedLocationsTable } from "@/components/locations/deleted-locations-table";
import { LocationsTable } from "@/components/locations/locations-table";

// Deliberate block: the page queries master data behind the HO session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = {
  name: siteLocation.name,
  siteName: site.name,
  isActive: siteLocation.isActive,
};
const DEFAULT_ORDER = [asc(site.name), asc(siteLocation.name)];
// The deleted view sorts by site, name or when the location was deleted,
// newest deletion first by default. buildOrder trails every user sort with
// this default, so the id breaks ties for any sort: locations deleted in the
// same instant (a bulk delete) keep one order and cannot swap between pages.
const SORTABLE_DELETED = {
  name: siteLocation.name,
  siteName: site.name,
  deletedAt: siteLocation.deletedAt,
};
const DEFAULT_ORDER_DELETED = [desc(siteLocation.deletedAt), asc(siteLocation.id)];

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function LocationsPage({
  searchParams,
}: PageProps<"/dashboard/locations">) {
  const actor = await requireHO();
  const rawParams = await searchParams;
  // ?show=deleted picks the soft-deleted list; it is not part of the shared
  // table params, so it is read off the raw search params.
  const deletedView = parseListView(rawParams.show) === "deleted";
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    rawParams,
    PAGE_SIZE_OPTIONS,
  );
  const isSuperadmin = actor.role === "superadmin";

  // A ho sees their own site's locations; a superadmin sees all sites.
  // A ho without a binding (invariant breach) sees nothing rather than
  // everything — hence sql`false` for the null siteId.
  const scope: SQL | undefined = isSuperadmin
    ? undefined
    : actor.siteId
      ? eq(siteLocation.siteId, actor.siteId)
      : sql`false`;

  // Site filter is a superadmin tool: a ho is already scoped to one site at
  // the data level, so the URL param is never consulted for them.
  const siteFilter: SQL | undefined =
    isSuperadmin && siteId ? eq(siteLocation.siteId, siteId) : undefined;

  const pattern = ilikePattern(q);
  // Name-only search; the joined site name is deliberately not searched
  // (locked decision 3). Null-safe and(...) composes scope+search+filters.
  // The deletedAt predicate splits the live list from the deleted one
  // (soft-delete epic #40); the scope stays in place for both, so an ho never
  // lists another site's deleted rows. This one `where` serves the count and
  // the listing below.
  const where = and(
    deletedView
      ? isNotNull(siteLocation.deletedAt)
      : isNull(siteLocation.deletedAt),
    ...(pattern ? [ilike(siteLocation.name, pattern)] : []),
    ...(status ? [eq(siteLocation.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = deletedView
    ? buildOrder(sorts, SORTABLE_DELETED, DEFAULT_ORDER_DELETED)
    : buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(siteLocation)
    .innerJoin(site, eq(siteLocation.siteId, site.id))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  const [sites, locations] = await Promise.all([
    db
      .select({ id: site.id, name: site.name })
      .from(site)
      .where(
        and(
          ...(isSuperadmin
            ? []
            : actor.siteId
              ? [eq(site.id, actor.siteId)]
              : [sql`false`]),
          isNull(site.deletedAt),
        ),
      )
      .orderBy(asc(site.name)),
    db
      .select({
        id: siteLocation.id,
        name: siteLocation.name,
        isActive: siteLocation.isActive,
        siteId: siteLocation.siteId,
        siteName: site.name,
        timezone: siteLocation.timezone,
        deletedAt: siteLocation.deletedAt,
      })
      .from(siteLocation)
      .innerJoin(site, eq(siteLocation.siteId, site.id))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">Locations</h1>
          <p className="text-sm text-muted-foreground">
            Workplace locations inside each site. Site admins are bound to
            exactly one location; queries are scoped at the data level.
          </p>
        </div>
        <CreateLocationButton sites={sites satisfies SiteOption[]} />
      </div>
      <Card>
        <CardContent>
          {deletedView ? (
            <DeletedLocationsTable
              locations={locations.map(
                ({ id, name, siteName, isActive, deletedAt }) => ({
                  id,
                  name,
                  siteName,
                  isActive,
                  deletedAt: (deletedAt as Date).toISOString(),
                }),
              )}
              sites={sites satisfies SiteOption[]}
              showSiteFilter={isSuperadmin}
              canPurge={isSuperadmin}
              pageCount={pageCount}
              total={rowCount}
            />
          ) : (
            <LocationsTable
              locations={locations.map(
                ({ id, name, isActive, siteId, siteName, timezone }) => ({
                  id,
                  name,
                  isActive,
                  siteId,
                  siteName,
                  timezone,
                }),
              )}
              sites={sites satisfies SiteOption[]}
              showSiteFilter={isSuperadmin}
              pageCount={pageCount}
              total={rowCount}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
