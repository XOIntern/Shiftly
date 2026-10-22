import { and, asc, count, eq, ilike, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { site, siteLocation, shiftDefinition } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreateShiftButton } from "@/app/dashboard/shifts/shift-dialog";
import type { SiteLocationOption, SiteOption } from "@/types/forms";
import { ShiftsTable } from "@/app/dashboard/shifts/shifts-table";

// Deliberate block: the page queries master data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = {
  label: shiftDefinition.label,
  orderIndex: shiftDefinition.orderIndex,
  startTime: shiftDefinition.startTime,
  isActive: shiftDefinition.isActive,
};
const DEFAULT_ORDER = [
  asc(site.name),
  asc(siteLocation.name),
  asc(shiftDefinition.orderIndex),
];

export default async function ShiftsPage({
  searchParams,
}: PageProps<"/dashboard/shifts">) {
  // requireUser, not a stricter guard: all three roles open the page —
  // they differ by the scope of rows shown, not by access (spec §3.1).
  const actor = await requireUser();
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    await searchParams,
    PAGE_SIZE_OPTIONS,
  );
  const isSuperadmin = actor.role === "superadmin";
  const isHo = actor.role === "ho";

  // Scope is fail-closed on the shift row itself: an ho by their site's
  // shifts, an admin by their own site_location's. A missing binding
  // (invariant breach) sees nothing rather than everything (sql`false`).
  const scope: SQL | undefined = isSuperadmin
    ? undefined
    : isHo
      ? actor.siteId
        ? eq(shiftDefinition.siteId, actor.siteId)
        : sql`false`
      : actor.siteLocationId
        ? eq(shiftDefinition.siteLocationId, actor.siteLocationId)
        : sql`false`;

  // Site filter is a superadmin tool: a ho (or an admin, via their
  // site_location) is already scoped at the data level, so the URL param
  // is never consulted for them.
  const siteFilter: SQL | undefined =
    isSuperadmin && siteId ? eq(shiftDefinition.siteId, siteId) : undefined;

  const pattern = ilikePattern(q);
  // Label-only search; the joined site/location names are deliberately not
  // searched (mirrors the work-areas page's locked decision). Null-safe
  // and(...) composes scope+search+filters.
  const where = and(
    ...(pattern ? [ilike(shiftDefinition.label, pattern)] : []),
    ...(status ? [eq(shiftDefinition.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(shiftDefinition)
    .innerJoin(siteLocation, eq(shiftDefinition.siteLocationId, siteLocation.id))
    .innerJoin(site, eq(shiftDefinition.siteId, site.id))
    .where(and(where, isNull(shiftDefinition.deletedAt)));
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  // Dialog options: the site_locations the actor's scope allows for the
  // location select — filtered to the actor's scope like the work-areas
  // page (superadmin: all locations; ho: their site's; admin: pinned to
  // their binding). An unbound actor gets nothing.
  const [siteLocations, sites, shifts] = await Promise.all([
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
    // Dialog site options for the site-first pick, selected straight from
    // site with per-role branches like the work-areas page: superadmin
    // sees all sites; an ho their own; an admin their binding's site (only
    // superadmin ever renders the site select, but the scoped shape keeps
    // the dialog uniform). An unbound actor gets nothing.
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
        id: shiftDefinition.id,
        label: shiftDefinition.label,
        orderIndex: shiftDefinition.orderIndex,
        startTime: shiftDefinition.startTime,
        endTime: shiftDefinition.endTime,
        isActive: shiftDefinition.isActive,
        siteLocationId: shiftDefinition.siteLocationId,
        siteId: shiftDefinition.siteId,
        siteName: site.name,
        locationName: siteLocation.name,
      })
      .from(shiftDefinition)
      .innerJoin(siteLocation, eq(shiftDefinition.siteLocationId, siteLocation.id))
      .innerJoin(site, eq(shiftDefinition.siteId, site.id))
      .where(and(where, isNull(shiftDefinition.deletedAt)))
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
  ]);

  const pinnedLocationName =
    actor.role === "admin" ? siteLocations[0]?.name : undefined;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
          <p className="text-sm text-muted-foreground">
            Labeled day slots per location, scoped per role. The roster and
            MP-request lines are built from these definitions.
          </p>
        </div>
        {/* View-only for an ho: their site's rows render, but the create
        entry (and row actions below) do not. */}
        {isHo ? null : (
          <CreateShiftButton
            siteLocations={siteLocations satisfies SiteLocationOption[]}
            sites={sites satisfies SiteOption[]}
            pinnedLocationName={pinnedLocationName}
          />
        )}
      </div>
      <Card>
        <CardContent>
          <ShiftsTable
            shifts={shifts}
            siteLocations={siteLocations satisfies SiteLocationOption[]}
            sites={sites satisfies SiteOption[]}
            pinnedLocationName={pinnedLocationName}
            canManage={!isHo}
            showSite={isSuperadmin}
            showLocation={actor.role !== "admin"}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
