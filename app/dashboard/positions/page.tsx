import { and, asc, count, eq, ilike, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { position, site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreatePositionButton } from "@/components/positions/position-form";
import type { SiteOption } from "@/types/site";
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

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function PositionsPage({
  searchParams,
}: PageProps<"/dashboard/positions">) {
  // requireUser, not requireHO: all three roles manage their own scope.
  const actor = await requireUser();
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    await searchParams,
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
  const where = and(
    ...(pattern ? [ilike(position.name, pattern)] : []),
    ...(status ? [eq(position.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
    isNull(site.deletedAt),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(position)
    .innerJoin(site, eq(position.siteId, site.id))
    .where(and(where, isNull(position.deletedAt)));
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
      })
      .from(position)
      .innerJoin(site, eq(position.siteId, site.id))
      .where(and(where, isNull(position.deletedAt)))
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
          <PositionsTable
            positions={positions}
            showSiteFilter={isSuperadmin}
            sites={sites satisfies SiteOption[]}
            pinnedSiteName={actor.role === "admin" ? sites[0]?.name : undefined}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
