import { asc, eq } from "drizzle-orm";

import { client, site } from "@/drizzle/schema";
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
  CreateSiteButton,
  DeleteSiteButton,
  EditSiteButton,
  ToggleSiteButton,
  type ClientOption,
} from "@/components/site-form";

// Deliberate block: the page queries master data behind the HO session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

export default async function SitesPage() {
  await requireHO();

  const [sites, clients] = await Promise.all([
    db
      .select({
        id: site.id,
        name: site.name,
        location: site.location,
        isActive: site.isActive,
        clientId: site.clientId,
        clientName: client.name,
      })
      .from(site)
      .innerJoin(client, eq(site.clientId, client.id))
      .orderBy(asc(client.name), asc(site.name)),
    db
      .select({ id: client.id, name: client.name })
      .from(client)
      .orderBy(asc(client.name)),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Client and site master data. Every non-HO user is bound to exactly
            one site; queries are scoped at the data level.
          </p>
        </div>
        <CreateSiteButton clients={clients satisfies ClientOption[]} />
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
                <TableHead className="min-w-[160px]">Client</TableHead>
                <TableHead className="min-w-[160px]">Location</TableHead>
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
                    <TableCell>{site.clientName}</TableCell>
                    <TableCell>{site.location}</TableCell>
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
                        <EditSiteButton site={site} clients={clients} />
                        <DeleteSiteButton site={site} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sites.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No sites yet — add the first one for a client.
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
