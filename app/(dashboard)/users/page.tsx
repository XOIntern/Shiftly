import { asc, and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { site, siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import {
  TABLE_PAGE_SIZE,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireHO } from "@/lib/session";
import { canManageActorTarget, userScopeFilter, type Role } from "@/lib/scope";
import { Card, CardContent } from "@/components/ui/card";
import {
  CreateUserButton,
  type LocationOption,
  type SiteOption,
  type UserFormData,
  type UserRow,
} from "@/components/user-form";
import { UsersTable } from "@/components/users-table";

// Deliberate block: the page queries master data behind the HO session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Second site join: admins get their site through the bound location, while
// ho rows carry it directly on user.siteId — the alias labels both paths.
const locationSite = alias(site, "location_site");

function bindingLabel(row: {
  role: Role;
  siteName: string | null;
  locationName: string | null;
  locationSiteName: string | null;
}): string | null {
  if (row.role === "superadmin") return null;
  if (row.role === "ho") return row.siteName;
  // Admins read "location (site)"; a malformed binding has no label.
  return row.locationName
    ? row.locationSiteName
      ? `${row.locationName} (${row.locationSiteName})`
      : row.locationName
    : null;
}

// Management rights over a resolved row come from the shared lib/scope
// gate (canManageActorTarget) — the page no longer keeps its own copy of the
// malformed-admin rule.
export default async function UsersPage({
  searchParams,
}: PageProps<"/users">) {
  // Server-side HO guard; the actions repeat it for direct calls.
  const actor = await requireHO();
  const { q, page, sort } = parseTableSearchParams(await searchParams);

  // URL-contract whitelists (epic #24) — the binding UI label is
  // JS-computed, so its SQL sort uses the joined location name. Postgres
  // ASC leaves NULL bindings last (accepted in the locked decisions).
  const SORTABLE = {
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    binding: siteLocation.name,
  };
  const DEFAULT_ORDER = [asc(user.role), asc(user.name)];

  const pattern = ilikePattern(q);
  // Role text matches too — natural through the same OR (allowed per #22);
  // the enum column needs a text cast for ILIKE.
  const search = pattern
    ? or(
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        sql`${user.role}::text ilike ${pattern}`,
      )
    : undefined;
  // Null-safe and(...) composes the listing scope with the search.
  const scope = userScopeFilter(actor);
  const where = and(
    ...(scope ? [scope] : []),
    ...(search ? [search] : []),
  );

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(user)
    .leftJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    .leftJoin(site, eq(user.siteId, site.id))
    .leftJoin(locationSite, eq(siteLocation.siteId, locationSite.id))
    // userScopeFilter reads siteLocation columns: the count carries every
    // join the listing does (issue #22).
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / TABLE_PAGE_SIZE));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  const [rows, allSites, allLocations] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        userSiteId: user.siteId,
        userSiteLocationId: user.siteLocationId,
        siteName: site.name,
        locationName: siteLocation.name,
        locationSiteId: siteLocation.siteId,
        locationSiteName: locationSite.name,
      })
      .from(user)
      .leftJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
      .leftJoin(site, eq(user.siteId, site.id))
      .leftJoin(locationSite, eq(siteLocation.siteId, locationSite.id))
      // Listing scoping (issue #18): an ho sees only users bound to its own
      // site — site-bound rows plus admins of the site's locations; a
      // superadmin gets undefined (= no WHERE) so drizzle filters nothing.
      .where(where)
      .orderBy(
        ...(sort && SORTABLE[sort.columnId as keyof typeof SORTABLE]
          ? [
              sort.dir === "desc"
                ? desc(SORTABLE[sort.columnId as keyof typeof SORTABLE])
                : asc(SORTABLE[sort.columnId as keyof typeof SORTABLE]),
            ]
          : DEFAULT_ORDER),
      )
      .limit(TABLE_PAGE_SIZE)
      .offset((clamped - 1) * TABLE_PAGE_SIZE),
    db.select({ id: site.id, name: site.name }).from(site).orderBy(asc(site.name)),
    db
      .select({
        id: siteLocation.id,
        name: siteLocation.name,
        siteId: siteLocation.siteId,
        siteName: site.name,
      })
      .from(siteLocation)
      .leftJoin(site, eq(siteLocation.siteId, site.id))
      .orderBy(asc(site.name), asc(siteLocation.name)),
  ]);

  // An ho provisions into its own site only: locations are pre-filtered so
  // the form can't offer a cross-site selection (the action re-checks it).
  // ho users are managed by superadmins alone, so ho never needs sites.
  const locations: LocationOption[] =
    actor.role === "ho"
      ? allLocations.filter((location) => location.siteId === actor.siteId)
      : allLocations;
  const sites: SiteOption[] = actor.role === "ho" ? [] : allSites;

  const entries = rows.map((row) => ({
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      binding: bindingLabel(row),
      isActive: row.isActive,
    } satisfies UserRow,
    form: {
      id: row.id,
      name: row.name,
      role: row.role,
      siteId: row.userSiteId,
      siteLocationId: row.userSiteLocationId,
    } satisfies UserFormData,
    canManage: canManageActorTarget(actor, row),
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Head-office, admin, and superadmin accounts. Admins only access
            the site location they are bound to.
          </p>
        </div>
        <CreateUserButton
          actorRole={actor.role}
          sites={sites}
          locations={locations}
        />
      </div>
      <Card>
        <CardContent>
          <UsersTable
            entries={entries}
            actorRole={actor.role}
            sites={sites}
            locations={locations}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
