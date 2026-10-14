import { asc, eq } from "drizzle-orm";

import { site, user } from "@/drizzle/schema";
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
  CreateUserButton,
  EditUserButton,
  ToggleUserButton,
  type SiteOption,
  type UserRow,
} from "@/components/user-form";
import { ResetPasswordButton } from "@/components/user-reset-password";

// Deliberate block: the page queries master data behind the HO session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

function RoleBadge({ role }: { role: UserRow["role"] }) {
  return role === "ho" ? (
    <Badge>Head office</Badge>
  ) : (
    <Badge variant="secondary">Site admin</Badge>
  );
}

export default async function UsersPage() {
  // Server-side HO guard; the actions repeat it for direct calls.
  await requireHO();

  const [rows, sites] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        siteId: user.siteId,
        siteName: site.name,
      })
      .from(user)
      .leftJoin(site, eq(user.siteId, site.id))
      .orderBy(asc(user.role), asc(user.name)),
    db
      .select({ id: site.id, name: site.name })
      .from(site)
      .orderBy(asc(site.name)),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Head-office and site-admin accounts. Site admins only access the
            site they are bound to.
          </p>
        </div>
        <CreateUserButton sites={sites satisfies SiteOption[]} />
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
                <TableHead className="min-w-[160px]">Site</TableHead>
                <TableHead className="min-w-[110px]">Status</TableHead>
                <TableHead className="min-w-[180px] text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableRowCells row={row} sites={sites} />
                </TableRow>
              ))}
              {rows.length === 0 && (
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
function TableRowCells({ row, sites }: { row: UserRow; sites: SiteOption[] }) {
  return (
    <>
      <TableCell className="font-medium">{row.name}</TableCell>
      <TableCell>{row.email}</TableCell>
      <TableCell>
        <RoleBadge role={row.role} />
      </TableCell>
      <TableCell>{row.siteName ?? "—"}</TableCell>
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
          <ToggleUserButton user={row} />
          <EditUserButton user={row} sites={sites} />
          <ResetPasswordButton user={row} />
        </div>
      </TableCell>
    </>
  );
}
