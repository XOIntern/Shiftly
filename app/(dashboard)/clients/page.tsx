import { count, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { requireHO } from "@/lib/session";
import { client, site } from "@/drizzle/schema";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateClientDialog, RenameClientDialog } from "@/components/client-form";
import { DeleteClientDialog } from "@/components/client-delete-dialog";

// Deliberate block: the layout gates the route on the session (auth),
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function ClientsPage() {
  // Server-side HO guard; the actions repeat it for direct calls.
  await requireHO();

  const rows = await db
    .select({
      id: client.id,
      name: client.name,
      createdAt: client.createdAt,
      siteCount: count(site.id),
    })
    .from(client)
    .leftJoin(site, eq(site.clientId, client.id))
    .groupBy(client.id)
    .orderBy(client.name);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <CreateClientDialog />
      </div>
      <p className="max-w-md text-sm text-muted-foreground">
        Company-level master data. Sites and users hang off each client; a
        client can only be deleted once no sites reference it.
      </p>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No clients yet.</p>
      )}
      {rows.length > 0 && (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Name</TableHead>
                  <TableHead className="min-w-[80px]">Sites</TableHead>
                  <TableHead className="min-w-[120px]">Created</TableHead>
                  <TableHead className="min-w-[140px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="tabular-nums">{row.siteCount}</TableCell>
                    <TableCell>{dateFormat.format(row.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <RenameClientDialog client={{ id: row.id, name: row.name }} />
                        {/* Delete is only offered when the client has no sites. */}
                        {row.siteCount === 0 && (
                          <DeleteClientDialog client={{ id: row.id, name: row.name }} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
