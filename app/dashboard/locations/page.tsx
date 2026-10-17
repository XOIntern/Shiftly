import { and, asc, count, eq, ilike, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireHO } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import {
  CreateLocationButton,
  type SiteOption,
} from "@/components/location-form";
import { LocationsTable } from "@/components/locations-table";

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

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function LocationsPage({
  searchParams,
}: PageProps<"/dashboard/locations">) {
  const actor = await requireHO();
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    await searchParams,
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
  const where = and(
    ...(pattern ? [ilike(siteLocation.name, pattern)] : []),
    ...(status ? [eq(siteLocation.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

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
        isSuperadmin
          ? undefined
          : actor.siteId
            ? eq(site.id, actor.siteId)
            : sql`false`,
      )
      .orderBy(asc(site.name)),
    db
      .select({
        id: siteLocation.id,
        name: siteLocation.name,
        isActive: siteLocation.isActive,
        siteId: siteLocation.siteId,
        siteName: site.name,
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
          <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
          <p className="text-sm text-muted-foreground">
            Workplace locations inside each site. Site admins are bound to
            exactly one location; queries are scoped at the data level.
          </p>
        </div>
        <CreateLocationButton sites={sites satisfies SiteOption[]} />
      </div>
      <Card>
        <CardContent>
          <LocationsTable
            locations={locations}
            sites={sites satisfies SiteOption[]}
            showSiteFilter={isSuperadmin}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
