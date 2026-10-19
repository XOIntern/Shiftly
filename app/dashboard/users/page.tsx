import { and, asc, count, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  department,
  site,
  siteLocation,
  user,
  workArea,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireHO } from "@/lib/session";
import { canManageActorTarget, userScopeFilter } from "@/lib/scope";
import type { Role } from "@/types/domain";
import { Card, CardContent } from "@/components/ui/card";
import {
  CreateUserButton,
  type DepartmentOption,
  type LocationOption,
  type SiteOption,
  type UserFormData,
  type UserRow,
  type WorkAreaOption,
} from "@/components/users/user-form";
import { UsersTable } from "@/components/users/users-table";

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
  // Admins read "site (location)" — site first, matching the Locations table
  // order; a malformed binding has no label.
  return row.locationName
    ? row.locationSiteName
      ? `${row.locationSiteName} (${row.locationName})`
      : row.locationName
    : null;
}

// Management rights over a resolved row come from the shared lib/scope
// gate (canManageActorTarget) — the page no longer keeps its own copy of the
// malformed-admin rule.
export default async function UsersPage({
  searchParams,
}: PageProps<"/dashboard/users">) {
  // Server-side HO guard; the actions repeat it for direct calls.
  const actor = await requireHO();
  const { q, status, role, page, sorts, pageSize } = parseTableSearchParams(
    await searchParams,
    PAGE_SIZE_OPTIONS,
  );

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
  // Null-safe and(...) composes the listing scope with search + filters.
  // The soft-delete guard sits here so both the count and the listing drop
  // deleted users — userScopeFilter covers the ho path, this covers the
  // superadmin path where the scope is undefined.
  const scope = userScopeFilter(actor);
  const where = and(
    isNull(user.deletedAt),
    ...(scope ? [scope] : []),
    ...(search ? [search] : []),
    ...(status ? [eq(user.isActive, status === "active")] : []),
    ...(role ? [eq(user.role, role)] : []),
  );
  // buildOrder own-property checks the whitelist: a plain truthiness guard
  // would admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(user)
    .leftJoin(siteLocation, eq(user.siteLocationId, siteLocation.id))
    .leftJoin(site, eq(user.siteId, site.id))
    .leftJoin(locationSite, eq(siteLocation.siteId, locationSite.id))
    // userScopeFilter reads siteLocation columns: the count carries every
    // join the listing does (issue #22).
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  const [rows, allSites, allLocations, allDepartments, allWorkAreas] =
    await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        userSiteId: user.siteId,
        userSiteLocationId: user.siteLocationId,
        userDepartmentId: user.departmentId,
        userWorkAreaId: user.workAreaId,
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
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
    db
      .select({ id: site.id, name: site.name })
      .from(site)
      // Form options must not offer a deleted site for provisioning.
      .where(isNull(site.deletedAt))
      .orderBy(asc(site.name)),
    db
      .select({
        id: siteLocation.id,
        name: siteLocation.name,
        siteId: siteLocation.siteId,
        siteName: site.name,
      })
      .from(siteLocation)
      .leftJoin(site, eq(siteLocation.siteId, site.id))
      // Same for a deleted location.
      .where(isNull(siteLocation.deletedAt))
      .orderBy(asc(site.name), asc(siteLocation.name)),
    // Departments/work areas for the dialogs (issue #66), mirroring the
    // sites/locations fetch: soft-deleted rows never come back as options.
    db
      .select({
        id: department.id,
        name: department.name,
        siteId: department.siteId,
      })
      .from(department)
      .where(isNull(department.deletedAt))
      .orderBy(asc(department.name)),
    db
      .select({
        id: workArea.id,
        name: workArea.name,
        siteLocationId: workArea.siteLocationId,
        siteId: workArea.siteId,
      })
      .from(workArea)
      .where(isNull(workArea.deletedAt))
      .orderBy(asc(workArea.name)),
  ]);

  // An ho provisions into its own site only: locations are pre-filtered so
  // the form can't offer a cross-site selection (the action re-checks it).
  // ho users are managed by superadmins alone, so ho never needs sites.
  const locations: LocationOption[] =
    actor.role === "ho"
      ? allLocations.filter((location) => location.siteId === actor.siteId)
      : allLocations;
  const sites: SiteOption[] = actor.role === "ho" ? [] : allSites;
  // Both new option lists shrink to the ho actor's own site (departments
  // are site-scoped; work areas carry their department's site). The
  // actions re-check the scope server-side either way.
  const departments: DepartmentOption[] =
    actor.role === "ho"
      ? allDepartments.filter((option) => option.siteId === actor.siteId)
      : allDepartments;
  const workAreas: WorkAreaOption[] =
    actor.role === "ho"
      ? allWorkAreas.filter((option) => option.siteId === actor.siteId)
      : allWorkAreas;

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
      departmentId: row.userDepartmentId,
      workAreaId: row.userWorkAreaId,
    } satisfies UserFormData,
    canManage: canManageActorTarget(actor, row),
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Head-office, admin, and superadmin accounts. Admins only access the
            site location they are bound to.
          </p>
        </div>
        <CreateUserButton
          actorRole={actor.role}
          sites={sites}
          locations={locations}
          departments={departments}
          workAreas={workAreas}
        />
      </div>
      <Card>
        <CardContent>
          <UsersTable
            entries={entries}
            actorRole={actor.role}
            sites={sites}
            locations={locations}
            departments={departments}
            workAreas={workAreas}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
