import { asc } from "drizzle-orm";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireSuperadmin } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { CreateSiteButton } from "@/components/site-form";
import { SitesTable } from "@/components/sites-table";

// Deliberate block: the page queries master data behind the superadmin session
// check, so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

export default async function SitesPage() {
  await requireSuperadmin();

  const sites = await db
    .select({
      id: site.id,
      name: site.name,
      isActive: site.isActive,
    })
    .from(site)
    .orderBy(asc(site.name));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Site master data. Locations hang off sites here, and queries are
            scoped at the data level.
          </p>
        </div>
        <CreateSiteButton />
      </div>
      <Card>
        <CardContent>
          <SitesTable sites={sites} />
        </CardContent>
      </Card>
    </div>
  );
}
