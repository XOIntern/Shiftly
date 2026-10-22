import { and, asc, count, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { position, site, siteLocation, workArea, workAreaPosition } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreateWorkAreaButton } from "@/components/work-areas/work-area-form";
import type {
  PositionRow,
  SiteLocationOption,
  SiteOption,
  WorkAreaRow,
} from "@/types/forms";
import { WorkAreasTable } from "@/components/work-areas/work-areas-table";

// Deliberate block: the page queries master data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = {
  name: workArea.name,
  siteName: site.name,
  isActive: workArea.isActive,
};
const DEFAULT_ORDER = [asc(site.name), asc(workArea.name)];

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function WorkAreasPage({
  searchParams,
}: PageProps<"/dashboard/work-areas">) {
  // requireUser, not requireHO: all three roles manage their own scope.
  const actor = await requireUser();
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    await searchParams,
    PAGE_SIZE_OPTIONS,
  );
  const isSuperadmin = actor.role === "superadmin";
  const isHo = actor.role === "ho";

  // Scope is fail-closed on the workArea row itself: an ho by their site's
  // work areas, an admin by their own site_location's (no derivation via
  // the location's site is needed here — the column exists on the row). A
  // missing binding (invariant breach) sees nothing rather than everything
  // (sql`false`).
  const scope: SQL | undefined = isSuperadmin
    ? undefined
    : isHo
      ? actor.siteId
        ? eq(workArea.siteId, actor.siteId)
        : sql`false`
      : actor.siteLocationId
        ? eq(workArea.siteLocationId, actor.siteLocationId)
        : sql`false`;

  // Site filter is a superadmin tool: a ho (or an admin, via their
  // site_location) is already scoped at the data level, so the URL param
  // is never consulted for them.
  const siteFilter: SQL | undefined =
    isSuperadmin && siteId ? eq(workArea.siteId, siteId) : undefined;

  const pattern = ilikePattern(q);
  // Name-only search; the joined site name is deliberately not searched
  // (locked decision 3). Null-safe and(...) composes scope+search+filters.
  const where = and(
    ...(pattern ? [ilike(workArea.name, pattern)] : []),
    ...(status ? [eq(workArea.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(workArea)
    .innerJoin(site, eq(workArea.siteId, site.id))
    .where(and(where, isNull(workArea.deletedAt)));
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  // Dialog options: the site_locations the actor's scope allows for the
  // location select — filtered to the actor's scope. Site locations shrink
  // to the actor's own bindings, and an unbound actor gets nothing.
  // Positions ride along for the edit dialog's required-positions picker,
  // scoped per role exactly like the workers page's catalog (live rows
  // only; inactive included so an attached requirement stays visible).
  const [siteLocations, sites, positions, workAreas] = await Promise.all([
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
    // Dialog/SiteFilter site options, selected straight from site like the
    // locations page, with per-role branches: superadmin sees all sites;
    // an ho their own site; an admin their binding's site via their
    // site_location row; an unbound actor gets nothing (sql`false`).
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
      .where(
        and(
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
        id: workArea.id,
        name: workArea.name,
        isActive: workArea.isActive,
        siteLocationId: workArea.siteLocationId,
        siteId: workArea.siteId,
        siteName: site.name,
        locationName: siteLocation.name,
      })
      .from(workArea)
      .innerJoin(siteLocation, eq(workArea.siteLocationId, siteLocation.id))
      .innerJoin(site, eq(workArea.siteId, site.id))
      .where(and(where, isNull(workArea.deletedAt)))
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
  ]);

  // The page's required-position sets, in one grouped follow-up query
  // (workers-page pattern): the edit dialog pre-fills its multi-select
  // from them, alphabetical by name.
  const workAreaIds = workAreas.map((row) => row.id);
  const pivotRows =
    workAreaIds.length === 0
      ? []
      : await db
          .select({
            workAreaId: workAreaPosition.workAreaId,
            id: position.id,
            name: position.name,
            isActive: position.isActive,
          })
          .from(workAreaPosition)
          .innerJoin(position, eq(workAreaPosition.positionId, position.id))
          .where(inArray(workAreaPosition.workAreaId, workAreaIds))
          .orderBy(asc(position.name));

  const positionsByWorkArea = new Map<string, WorkAreaRow["positions"]>();
  for (const row of pivotRows) {
    const set = positionsByWorkArea.get(row.workAreaId) ?? [];
    set.push({ id: row.id, name: row.name, isActive: row.isActive });
    positionsByWorkArea.set(row.workAreaId, set);
  }

  const workAreaRows: WorkAreaRow[] = workAreas.map((row) => ({
    ...row,
    positions: positionsByWorkArea.get(row.id) ?? [],
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Work areas</h1>
          <p className="text-sm text-muted-foreground">
            Operational zones within each location, scoped per role. Every role
            manages work areas within its own scope.
          </p>
        </div>
        <CreateWorkAreaButton
          siteLocations={siteLocations satisfies SiteLocationOption[]}
          sites={sites satisfies SiteOption[]}
          pinnedLocationName={
            actor.role === "admin" ? siteLocations[0]?.name : undefined
          }
        />
      </div>
      <Card>
        <CardContent>
          <WorkAreasTable
            workAreas={workAreaRows}
            siteLocations={siteLocations satisfies SiteLocationOption[]}
            pinnedLocationName={
              actor.role === "admin" ? siteLocations[0]?.name : undefined
            }
            showSiteFilter={isSuperadmin}
            sites={sites satisfies SiteOption[]}
            positions={positions satisfies PositionRow[]}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
