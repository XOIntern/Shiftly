import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { position, site, siteLocation, worker } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreateWorkerButton } from "@/components/workers/worker-form";
import type { PositionRow, SiteLocationOption, SiteOption } from "@/types/forms";
import { WorkersTable } from "@/components/workers/workers-table";

// Deliberate block: the page queries master data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = {
  employeeId: worker.employeeId,
  name: worker.name,
  siteName: site.name,
  contractEndDate: worker.contractEndDate,
  isActive: worker.isActive,
};
const DEFAULT_ORDER = [asc(site.name), asc(worker.employeeId)];

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function WorkersPage({
  searchParams,
}: PageProps<"/dashboard/workers">) {
  // requireUser, not requireHO: all three roles manage their own scope.
  const actor = await requireUser();
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    await searchParams,
    PAGE_SIZE_OPTIONS,
  );
  const isSuperadmin = actor.role === "superadmin";
  const isHo = actor.role === "ho";

  // Scope is fail-closed on the worker row itself: an ho by their site;
  // an admin welded to their own site_location binding (the column exists
  // on the row — never derived via the location's site). A missing binding
  // (invariant breach) sees nothing rather than everything (sql`false`).
  const scope: SQL | undefined = isSuperadmin
    ? undefined
    : isHo
      ? actor.siteId
        ? eq(worker.siteId, actor.siteId)
        : sql`false`
      : actor.siteLocationId
        ? eq(worker.siteLocationId, actor.siteLocationId)
        : sql`false`;

  // Site filter is a superadmin tool: a ho (or an admin, via their
  // binding) is already scoped at the data level, so the URL param
  // is never consulted for them.
  const siteFilter: SQL | undefined =
    isSuperadmin && siteId ? eq(worker.siteId, siteId) : undefined;

  const pattern = ilikePattern(q);
  // Name + employee-id search; site/location/position names are
  // deliberately not searched. Null-safe and(...) composes
  // scope+search+filters.
  const where = and(
    ...(pattern
      ? [
          or(
            ilike(worker.name, pattern),
            ilike(worker.employeeId, pattern),
          ),
        ]
      : []),
    ...(status ? [eq(worker.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(worker)
    // The site join is needed by the where/order even though the count
    // fetches no columns.
    .innerJoin(site, eq(worker.siteId, site.id))
    .where(and(where, isNull(worker.deletedAt)));
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  // Dialog options fetched with the rows query: the sites the actor may
  // target (positions-page pattern), the site_locations under their scope,
  // and the live+active positions for those sites. For an admin the
  // location list shrinks to their binding row — what pinnedLocationName
  // reads. An unbound actor gets nothing from any branch (sql`false`).
  const [sites, siteLocations, positions, workers] = await Promise.all([
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
        id: siteLocation.id,
        name: siteLocation.name,
        siteId: siteLocation.siteId,
      })
      .from(siteLocation)
      .where(
        and(
          ...(isSuperadmin
            ? []
            : isHo
              ? actor.siteId
                ? [eq(siteLocation.siteId, actor.siteId)]
                : [sql`false`]
              : actor.siteLocationId
                ? [eq(siteLocation.id, actor.siteLocationId)]
                : [sql`false`]),
          isNull(siteLocation.deletedAt),
        ),
      )
      .orderBy(asc(siteLocation.name)),
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
      .where(
        and(
          // Live+active: deactivated positions never enter the picker
          // (the form keeps this as a defensive guard only).
          isNull(position.deletedAt),
          eq(position.isActive, true),
          isNull(site.deletedAt),
          ...(isSuperadmin
            ? []
            : isHo
              ? actor.siteId
                ? [eq(position.siteId, actor.siteId)]
                : [sql`false`]
              : actor.siteLocationId
                ? [
                    eq(
                      position.siteId,
                      db
                        .select({ siteId: siteLocation.siteId })
                        .from(siteLocation)
                        .where(
                          eq(siteLocation.id, actor.siteLocationId),
                        ),
                    ),
                  ]
                : [sql`false`]),
        ),
      )
      .orderBy(asc(position.name)),
    db
      .select({
        id: worker.id,
        employeeId: worker.employeeId,
        name: worker.name,
        isActive: worker.isActive,
        contractEndDate: worker.contractEndDate,
        siteLocationId: worker.siteLocationId,
        positionId: worker.positionId,
        siteId: worker.siteId,
        siteName: site.name,
        locationName: siteLocation.name,
        positionName: position.name,
      })
      .from(worker)
      .innerJoin(siteLocation, eq(worker.siteLocationId, siteLocation.id))
      .innerJoin(site, eq(worker.siteId, site.id))
      .innerJoin(position, eq(worker.positionId, position.id))
      .where(and(where, isNull(worker.deletedAt)))
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
          <p className="text-sm text-muted-foreground">
            Worker master data per site_location, scoped per role. Every role
            manages workers within its own scope.
          </p>
        </div>
        <CreateWorkerButton
          positions={positions satisfies PositionRow[]}
          sites={sites satisfies SiteOption[]}
          siteLocations={siteLocations satisfies SiteLocationOption[]}
          pinnedLocationName={
            actor.role === "admin"
              ? sites[0] && siteLocations[0]?.name
              : undefined
          }
        />
      </div>
      <Card>
        <CardContent>
          <WorkersTable
            workers={workers}
            showSiteFilter={isSuperadmin}
            sites={sites satisfies SiteOption[]}
            siteLocations={siteLocations satisfies SiteLocationOption[]}
            positions={positions}
            pinnedLocationName={
              actor.role === "admin"
                ? sites[0] && siteLocations[0]?.name
                : undefined
            }
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
