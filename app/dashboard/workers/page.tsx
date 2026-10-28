import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  position,
  site,
  siteLocation,
  worker,
  workerPosition,
} from "@/drizzle/schema";
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
import { CreateWorkerButton } from "@/components/workers/worker-form";
import type { PositionRow } from "@/types/position";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import type { WorkerRow } from "@/types/worker";
import { DeletedWorkersTable } from "@/components/workers/deleted-workers-table";
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
// The deleted view sorts by employee id, name, site, location or when the
// worker was deleted, newest deletion first by default. buildOrder trails
// every user sort with this default, so the id breaks ties for any sort:
// workers deleted in the same instant (a bulk delete) keep one order and
// cannot swap between pages.
const SORTABLE_DELETED = {
  employeeId: worker.employeeId,
  name: worker.name,
  siteName: site.name,
  locationName: siteLocation.name,
  deletedAt: worker.deletedAt,
};
const DEFAULT_ORDER_DELETED = [desc(worker.deletedAt), asc(worker.id)];

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function WorkersPage({
  searchParams,
}: PageProps<"/dashboard/workers">) {
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
  // The deletedAt predicate splits the live list from the deleted one
  // (soft-delete epic #40); the scope stays in place for both, so nobody lists
  // another site's or location's deleted rows. This one `where` serves the
  // count and the listing below.
  const where = and(
    deletedView ? isNotNull(worker.deletedAt) : isNull(worker.deletedAt),
    ...(pattern
      ? [or(ilike(worker.name, pattern), ilike(worker.employeeId, pattern))]
      : []),
    ...(status ? [eq(worker.isActive, status === "active")] : []),
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
    .from(worker)
    // The site join is needed by the where/order even though the count
    // fetches no columns.
    .innerJoin(site, eq(worker.siteId, site.id))
    .where(where);
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
          // Live, inactive included: the form must render (and let the user
          // remove) an attached position that was deactivated after the
          // pick, while only active rows are offered for new picks.
          isNull(position.deletedAt),
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
                        .where(eq(siteLocation.id, actor.siteLocationId)),
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
        siteId: worker.siteId,
        siteName: site.name,
        locationName: siteLocation.name,
        deletedAt: worker.deletedAt,
      })
      .from(worker)
      .innerJoin(siteLocation, eq(worker.siteLocationId, siteLocation.id))
      .innerJoin(site, eq(worker.siteId, site.id))
      // No pivot join here: it would duplicate worker rows. The set is
      // fetched once for the whole page below.
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
  ]);

  // The page's qualification sets, in one grouped follow-up query (spec
  // §6.1): every position name the table shows, in name order.
  // The deleted list has no edit dialog, so it needs no sets.
  const workerIds = deletedView ? [] : workers.map((row) => row.id);
  const pivotRows =
    workerIds.length === 0
      ? []
      : await db
          .select({
            workerId: workerPosition.workerId,
            id: position.id,
            name: position.name,
            isActive: position.isActive,
          })
          .from(workerPosition)
          .innerJoin(position, eq(workerPosition.positionId, position.id))
          .where(inArray(workerPosition.workerId, workerIds))
          .orderBy(asc(position.name));

  const positionsByWorker = new Map<string, WorkerRow["positions"]>();
  for (const row of pivotRows) {
    const set = positionsByWorker.get(row.workerId) ?? [];
    set.push({ id: row.id, name: row.name, isActive: row.isActive });
    positionsByWorker.set(row.workerId, set);
  }

  const workerRows: WorkerRow[] = workers.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    name: row.name,
    isActive: row.isActive,
    contractEndDate: row.contractEndDate,
    siteLocationId: row.siteLocationId,
    siteId: row.siteId,
    siteName: row.siteName,
    locationName: row.locationName,
    positions: positionsByWorker.get(row.id) ?? [],
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="page-title">Workers</h1>
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
          {deletedView ? (
            <DeletedWorkersTable
              workers={workers.map(
                ({
                  id,
                  employeeId,
                  name,
                  siteName,
                  locationName,
                  deletedAt,
                }) => ({
                  id,
                  employeeId,
                  name,
                  siteName,
                  locationName,
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
            <WorkersTable
              workers={workerRows}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
