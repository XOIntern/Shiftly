import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { site, siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireHO } from "@/lib/session";
import { canManageActorTarget, userScopeFilter, type Role } from "@/lib/scope";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CreateUserButton,
  EditUserButton,
  ToggleUserButton,
  type LocationOption,
  type SiteOption,
  type UserFormData,
  type UserRow,
} from "@/components/user-form";
import { ResetPasswordButton } from "@/components/user-reset-password";

// Deliberate block: the page queries master data behind the HO session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Second site join: admins get their site through the bound location, while
// ho rows carry it directly on user.siteId — the alias labels both paths.
const locationSite = alias(site, "location_site");

function RoleBadge({ role }: { role: UserRow["role"] }) {
  return role === "superadmin" ? (
    <Badge>Superadmin</Badge>
  ) : role === "ho" ? (
    <Badge>Head office</Badge>
  ) : (
    <Badge variant="secondary">Admin</Badge>
  );
}

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
export default async function UsersPage() {
  // Server-side HO guard; the actions repeat it for direct calls.
  const actor = await requireHO();

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
      .where(userScopeFilter(actor))
      .orderBy(asc(user.role), asc(user.name)),
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
        <CardHeader>
          <CardTitle>All users</CardTitle>
          <CardDescription>
            Deactivated users are signed out immediately and cannot log in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Name</TableHead>
                <TableHead className="min-w-[220px]">Email</TableHead>
                <TableHead className="min-w-[130px]">Role</TableHead>
                <TableHead className="min-w-[180px]">Binding</TableHead>
                <TableHead className="min-w-[110px]">Status</TableHead>
                <TableHead className="min-w-[180px] text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.user.id}>
                  <TableRowCells
                    entry={entry}
                    actorRole={actor.role}
                    sites={sites}
                    locations={locations}
                  />
                </TableRow>
              ))}
              {entries.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Kept inline to avoid re-mapping — a locally declared sub-render keeps the
// row bodies readable without inventing new abstractions.
function TableRowCells({
  entry,
  actorRole,
  sites,
  locations,
}: {
  entry: { user: UserRow; form: UserFormData; canManage: boolean };
  actorRole: Role;
  sites: SiteOption[];
  locations: LocationOption[];
}) {
  const { user: row, form, canManage } = entry;
  return (
    <>
      <TableCell className="font-medium">{row.name}</TableCell>
      <TableCell>{row.email}</TableCell>
      <TableCell>
        <RoleBadge role={row.role} />
      </TableCell>
      <TableCell>{row.binding ?? "—"}</TableCell>
      <TableCell>
        {row.isActive ? (
          <Badge variant="secondary">Active</Badge>
        ) : (
          <Badge variant="outline" className="px-1.5 text-muted-foreground">
            Inactive
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {canManage ? (
            <>
              <ToggleUserButton user={row} />
              <EditUserButton
                actorRole={actorRole}
                user={form}
                sites={sites}
                locations={locations}
              />
              <ResetPasswordButton user={row} />
            </>
          ) : null}
        </div>
      </TableCell>
    </>
  );
}
