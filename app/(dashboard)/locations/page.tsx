import { asc, eq, sql } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireHO } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import {
  CreateLocationButton,
  type SiteOption,
} from "@/components/location-form";
import { LocationsTable } from "@/components/locations-table";

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
        <CardContent>
          <LocationsTable
            locations={locations}
            sites={sites satisfies SiteOption[]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
