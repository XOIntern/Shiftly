import { asc } from "drizzle-orm";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireSuperadmin } from "@/lib/session";
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
  CreateSiteButton,
  DeleteSiteButton,
  EditSiteButton,
  ToggleSiteButton,
} from "@/components/site-form";

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
        <CardHeader>
          <CardTitle>All sites</CardTitle>
          <CardDescription>
            Deactivated sites stop receiving rosters but keep their history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Name</TableHead>
                <TableHead className="min-w-[100px]">Status</TableHead>
                <TableHead className="min-w-[180px] text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((site) => {
                return (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell>
                      {site.isActive ? (
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
                        <ToggleSiteButton site={site} />
                        <EditSiteButton site={site} />
                        <DeleteSiteButton site={site} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sites.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No sites yet — add the first one.
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
