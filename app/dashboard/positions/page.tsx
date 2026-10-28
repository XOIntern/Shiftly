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

import { position, site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { parseListView } from "@/lib/list-view";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreatePositionButton } from "@/components/positions/position-form";
import type { SiteOption } from "@/types/site";
import { DeletedPositionsTable } from "@/components/positions/deleted-positions-table";
import { PositionsTable } from "@/components/positions/positions-table";

// Deliberate block: the page queries master data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = {
  name: position.name,
  siteName: site.name,
  isActive: position.isActive,
};
const DEFAULT_ORDER = [asc(site.name), asc(position.name)];
// The deleted view sorts by site, name or when the position was deleted,
// newest deletion first by default. buildOrder trails every user sort with
// this default, so the id breaks ties for any sort: positions deleted in the
// same instant (a bulk delete) keep one order and cannot swap between pages.
const SORTABLE_DELETED = {
  name: position.name,
  siteName: site.name,
  deletedAt: position.deletedAt,
};
const DEFAULT_ORDER_DELETED = [desc(position.deletedAt), asc(position.id)];

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function PositionsPage({
  searchParams,
}: PageProps<"/dashboard/positions">) {
  // requireUser, not requireHO: all three roles manage their own scope.
  const actor = await requireUser();
  const rawParams = await searchParams;
  // ?show=deleted picks the soft-deleted list; it is not part of the shared
  // table params, so it is read off the raw search params.
  const deletedView = parseListView(rawParams.show) === "deleted";
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    rawParams,
    PAGE_SIZE_OPTIONS,
  );
  const isSuperadmin = actor.role === "superadmin";
  const isHo = actor.role === "ho";

  // Scope is fail-closed on the position row itself: an ho by their site;
  // an admin by the site of their site_location binding (scalar subquery —
  // a dead binding yields NULL and can never match); superadmin unscoped.
  const scope: SQL | undefined = isSuperadmin
    ? undefined
    : isHo
      ? actor.siteId
        ? eq(position.siteId, actor.siteId)
        : sql`false`
      : actor.siteLocationId
        ? eq(
            position.siteId,
            db
              .select({ siteId: siteLocation.siteId })
              .from(siteLocation)
              .where(eq(siteLocation.id, actor.siteLocationId)),
          )
        : sql`false`;

  // Site filter is a superadmin tool: a ho (or an admin, via their
  // binding's site) is already scoped at the data level, so the URL param
  // is never consulted for them.
  const siteFilter: SQL | undefined =
    isSuperadmin && siteId ? eq(position.siteId, siteId) : undefined;

  const pattern = ilikePattern(q);
  // Name-only search; the joined site name is deliberately not searched
  // (locked decision 3). Null-safe and(...) composes scope+search+filters.
  // The deletedAt predicate splits the live list from the deleted one
  // (soft-delete epic #40); the scope stays in place for both, so nobody lists
  // another site's deleted rows. The live list hides positions of a deleted
  // site, the deleted list keeps them: restore is where that gets explained.
  // This one `where` serves the count and the listing below.
  const where = and(
    deletedView
      ? isNotNull(position.deletedAt)
      : isNull(position.deletedAt),
    ...(pattern ? [ilike(position.name, pattern)] : []),
    ...(status ? [eq(position.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
    ...(deletedView ? [] : [isNull(site.deletedAt)]),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = deletedView
    ? buildOrder(sorts, SORTABLE_DELETED, DEFAULT_ORDER_DELETED)
    : buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(position)
    .innerJoin(site, eq(position.siteId, site.id))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  // Dialog/SiteFilter site options, selected straight from site like the
  // locations page, with per-role branches: superadmin sees all sites; an
  // ho their own site; an admin their binding's site via their
  // site_location row; an unbound actor gets nothing (sql`false`).
  const [sites, positions] = await Promise.all([
    isSuperadmin
      ? db
          .select({ id: site.id, name: site.name })
          .from(site)
          .where(isNull(site.deletedAt))
          .orderBy(asc(site.name))
      : isHo
        ? actor.siteId
          ? db
              .select({ id: site.id, name: site.name })
              .from(site)
              .where(and(eq(site.id, actor.siteId), isNull(site.deletedAt)))
              .orderBy(asc(site.name))
          : Promise.resolve([])
        : actor.siteLocationId
          ? db
              .selectDistinct({ id: site.id, name: site.name })
              .from(site)
              .innerJoin(siteLocation, eq(site.id, siteLocation.siteId))
              .where(
                and(
                  eq(siteLocation.id, actor.siteLocationId),
                  isNull(site.deletedAt),
                ),
              )
              .orderBy(asc(site.name))
          : Promise.resolve([]),
    db
      .select({
        id: position.id,
        name: position.name,
        isActive: position.isActive,
        siteId: position.siteId,
        siteName: site.name,
        deletedAt: position.deletedAt,
      })
      .from(position)
      .innerJoin(site, eq(position.siteId, site.id))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">Positions</h1>
          <p className="text-sm text-muted-foreground">
            Job positions per site, scoped per role. Every role manages
            positions within its own scope.
          </p>
        </div>
        <CreatePositionButton
          sites={sites satisfies SiteOption[]}
          pinnedSiteName={actor.role === "admin" ? sites[0]?.name : undefined}
        />
      </div>
      <Card>
        <CardContent>
          {deletedView ? (
            <DeletedPositionsTable
              positions={positions.map(
                ({ id, name, siteName, deletedAt }) => ({
                  id,
                  name,
                  siteName,
                  deletedAt: (deletedAt as Date).toISOString(),
                }),
              )}
              showSiteFilter={isSuperadmin}
              sites={sites satisfies SiteOption[]}
              canPurge={isSuperadmin}
              pageCount={pageCount}
              total={rowCount}
            />
          ) : (
            <PositionsTable
              positions={positions.map(
                ({ id, name, isActive, siteId, siteName }) => ({
                  id,
                  name,
                  isActive,
                  siteId,
                  siteName,
                }),
              )}
              showSiteFilter={isSuperadmin}
              sites={sites satisfies SiteOption[]}
              pinnedSiteName={
                actor.role === "admin" ? sites[0]?.name : undefined
              }
              pageCount={pageCount}
              total={rowCount}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
