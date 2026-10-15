"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import { setActiveBulk } from "@/app/(dashboard)/users/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { Badge } from "@/components/ui/badge";
import {
  type LocationOption,
  type SiteOption,
  UserRowActions,
  type UserFormData,
  type UserRow,
} from "@/components/user-form";
import type { Role } from "@/lib/scope";

const helper = createColumnHelper<
  typeof dataTableFeatures,
  {
    user: UserRow;
    form: UserFormData;
    canManage: boolean;
  }
>();

export function UsersTable({
  entries,
  actorRole,
  sites,
  locations,
  pageCount,
  total,
}: {
  entries: { user: UserRow; form: UserFormData; canManage: boolean }[];
  actorRole: Role;
  sites: SiteOption[];
  locations: LocationOption[];
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns; the dialogs need role + form options.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor((row) => row.user.name, {
          id: "name",
          header: "Name",
          meta: {
            thClassName: "min-w-[180px]",
            tdClassName: "font-medium",
            sortable: true,
          },
        }),
        helper.accessor((row) => row.user.email, {
          id: "email",
          header: "Email",
          meta: { thClassName: "min-w-[220px]", sortable: true },
        }),
        helper.accessor((row) => row.user.role, {
          id: "role",
          header: "Role",
          meta: { thClassName: "min-w-[130px]", sortable: true },
          cell: (info) => {
            const role = info.getValue();
            return role === "superadmin" ? (
              <Badge>Superadmin</Badge>
            ) : role === "ho" ? (
              <Badge>Head office</Badge>
            ) : (
              <Badge variant="secondary">Admin</Badge>
            );
          },
        }),
        helper.accessor((row) => row.user.binding ?? "", {
          id: "binding",
          header: "Binding",
          meta: { thClassName: "min-w-[180px]", sortable: true },
          cell: (info) => info.getValue() || "—",
        }),
        helper.accessor((row) => row.user.isActive, {
          id: "isActive",
          header: "Status",
          meta: { thClassName: "min-w-[110px]", sortable: true },
          cell: (info) =>
            info.getValue() ? (
              <Badge variant="secondary">Active</Badge>
            ) : (
              <Badge variant="outline" className="px-1.5 text-muted-foreground">
                Inactive
              </Badge>
            ),
        }),
        helper.display({
          id: "actions",
          header: "Actions",
          meta: {
            thClassName: "min-w-[180px] text-right",
            tdClassName: "text-right",
          },
          cell: (info) =>
            info.row.original.canManage ? (
              <UserRowActions
                user={info.row.original.user}
                form={info.row.original.form}
                actorRole={actorRole}
                sites={sites}
                locations={locations}
              />
            ) : null,
        }),
      ]),
    [actorRole, sites, locations],
  );

  return (
    <DataTable
      columns={columns}
      data={entries}
      pageCount={pageCount}
      total={total}
      emptyMessage="No users yet."
      getRowId={(row) => row.user.id}
      // Unmanageable rows (the ho's own, foreign accounts) render no
      // checkbox and are never select-all targets.
      canSelectRow={(row) => row.canManage}
      selectionToolbar={({ count, ids, clear }) => (
        <BulkToolbar
          entityName="user"
          count={count}
          clear={clear}
          onActivate={() => setActiveBulk(ids, true)}
          onDeactivate={() => setActiveBulk(ids, false)}
        />
      )}
    />
  );
}
