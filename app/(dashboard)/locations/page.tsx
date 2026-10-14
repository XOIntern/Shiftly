import { asc, eq, sql } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireHO } from "@/lib/session";
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
  CreateLocationButton,
  DeleteLocationButton,
  EditLocationButton,
  ToggleLocationButton,
  type LocationRow,
  type SiteOption,
} from "@/components/location-form";

// Deliberate block: the page queries master data behind the HO session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

export default async function LocationsPage() {
  const actor = await requireHO();
  const isSuperadmin = actor.role === "superadmin";

  const [locations, sites] = await Promise.all([
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
      // A ho sees their own site's locations; a superadmin sees all sites.
      // A ho without a binding (invariant breach) sees nothing rather than
      // everything — hence sql`false` for the null siteId.
      .where(
        isSuperadmin
          ? undefined
          : actor.siteId
            ? eq(siteLocation.siteId, actor.siteId)
            : sql`false`,
      )
      .orderBy(asc(site.name), asc(siteLocation.name)),
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
        <CardHeader>
          <CardTitle>All locations</CardTitle>
          <CardDescription>
            Deactivated locations keep their users behind the site&apos;s
            normal rostering.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Location</TableHead>
                <TableHead className="min-w-[160px]">Site</TableHead>
                <TableHead className="min-w-[160px]">Address</TableHead>
                <TableHead className="min-w-[100px]">Status</TableHead>
                <TableHead className="min-w-[180px] text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location: LocationRow) => {
                return (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium">
                      {location.name}
                    </TableCell>
                    <TableCell>{location.siteName}</TableCell>
                    <TableCell>{location.address}</TableCell>
                    <TableCell>
                      {location.isActive ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="px-1.5 text-muted-foreground"
                        >
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <ToggleLocationButton location={location} />
                        <EditLocationButton
                          location={location}
                          sites={sites}
                        />
                        <DeleteLocationButton location={location} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {locations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No locations yet — add the first one for a site.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
