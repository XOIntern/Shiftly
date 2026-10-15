import { asc, and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  TABLE_PAGE_SIZE,
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
  address: siteLocation.address,
  isActive: siteLocation.isActive,
};
const DEFAULT_ORDER = [asc(site.name), asc(siteLocation.name)];

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function LocationsPage({
  searchParams,
}: PageProps<"/locations">) {
  const actor = await requireHO();
  const { q, page, sort } = parseTableSearchParams(await searchParams);
  const isSuperadmin = actor.role === "superadmin";

  // A ho sees their own site's locations; a superadmin sees all sites.
  // A ho without a binding (invariant breach) sees nothing rather than
  // everything — hence sql`false` for the null siteId.
  const scope: SQL | undefined = isSuperadmin
    ? undefined
    : actor.siteId
      ? eq(siteLocation.siteId, actor.siteId)
      : sql`false`;

  const pattern = ilikePattern(q);
  // Name OR address search; the joined site name is deliberately not
  // searched (locked decision 3). Null-safe and(...) composes scope+search.
  const where = and(
    ...(pattern ? [or(ilike(siteLocation.name, pattern), ilike(siteLocation.address, pattern))] : []),
    ...(scope ? [scope] : []),
  );

  // Own-property lookup: a plain truthiness guard would admit prototype-chain
  // `columnIds` (e.g. `?sort=__proto__`), which drizzle rejects mid-render.
  const sortColumn =
    sort && Object.hasOwn(SORTABLE, sort.columnId)
      ? SORTABLE[sort.columnId as keyof typeof SORTABLE]
      : undefined;

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(siteLocation)
    .innerJoin(site, eq(siteLocation.siteId, site.id))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / TABLE_PAGE_SIZE));
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
        address: siteLocation.address,
        isActive: siteLocation.isActive,
        siteId: siteLocation.siteId,
        siteName: site.name,
      })
      .from(siteLocation)
      .innerJoin(site, eq(siteLocation.siteId, site.id))
      .where(where)
      .orderBy(
        ...(sortColumn && sort
          ? [sort.dir === "desc" ? desc(sortColumn) : asc(sortColumn)]
          : DEFAULT_ORDER),
      )
      .limit(TABLE_PAGE_SIZE)
      .offset((clamped - 1) * TABLE_PAGE_SIZE),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
          <p className="max-w-md text-sm text-muted-foreground">
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
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
