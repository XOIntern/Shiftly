"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  purgeUser,
  purgeUserBulk,
  restoreUser,
  restoreUserBulk,
} from "@/app/dashboard/users/actions";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedBulkToolbar } from "@/components/deleted-bulk-toolbar";
import { DeletedListFilter } from "@/components/deleted-list-filter";
import { DeletedRowActions } from "@/components/deleted-row-actions";
import { RoleFilter } from "@/components/role-filter";
import { StatusFilter } from "@/components/status-filter";
import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "@/components/users/purge-copy";
import { nounFor } from "@/lib/bulk-summary";
import type { Role } from "@/types/domain";
import type { DeletedUserRow } from "@/types/user";

const helper = createColumnHelper<typeof dataTableFeatures, DeletedUserRow>();

const userNoun = nounFor("user");

const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Superadmin",
  ho: "Head office",
  admin: "Admin",
};

// Restore is open to the HO (inside their site) and the superadmin;
// permanent delete is a superadmin tool, so canPurge hides it for the HO
// instead of leaving a control that can only fail.
export function DeletedUsersTable({
  users,
  canPurge,
  pageCount,
  total,
}: {
  users: DeletedUserRow[];
  canPurge: boolean;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns across renders.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Name",
          meta: {
            thClassName: "min-w-[180px]",
            tdClassName: "font-medium",
            sortable: true,
          },
        }),
        helper.accessor("email", {
          header: "Email",
          meta: { thClassName: "min-w-[220px]", sortable: true },
        }),
        helper.accessor("role", {
          header: "Role",
          meta: { thClassName: "min-w-[130px]", sortable: true },
          cell: (info) => ROLE_LABELS[info.getValue()],
        }),
        helper.accessor((row) => row.binding ?? "", {
          id: "binding",
          header: "Binding",
          meta: { thClassName: "min-w-[180px]", sortable: true },
          cell: (info) => info.getValue() || "—",
        }),
        helper.accessor("deletedAt", {
          header: "Deleted",
          meta: { thClassName: "min-w-[120px]", sortable: true },
          // YYYY-MM-DD from the ISO string: no locale or timezone work, so
          // the server and the client print the same thing.
          cell: (info) => info.getValue().slice(0, 10),
        }),
        helper.display({
          id: "actions",
          header: "Actions",
          meta: {
            thClassName: "min-w-[100px] text-right",
            tdClassName: "text-right",
          },
          cell: (info) => {
            const { id, name } = info.row.original;
            return (
              <DeletedRowActions
                name={name}
                restore={() => restoreUser(id)}
                purge={() => purgeUser(id)}
                purgeDescription={purgeDescription(name)}
                purgeSuccess={purgeSuccessMessage(name)}
                canPurge={canPurge}
              />
            );
          },
        }),
      ]),
    [canPurge],
  );

  return (
    <DataTable
      columns={columns}
      data={users}
      pageCount={pageCount}
      total={total}
      emptyMessage="No deleted users."
      filters={
        <>
          <RoleFilter />
          <StatusFilter />
          <DeletedListFilter singular="user" plural="users" />
        </>
      }
      getRowId={(row) => row.id}
      selectionToolbar={({ count, ids, clear }) => (
        <DeletedBulkToolbar
          count={count}
          ids={ids}
          clear={clear}
          noun={userNoun}
          restore={restoreUserBulk}
          purge={purgeUserBulk}
          bulkPurgeDescription={bulkPurgeDescription}
          canPurge={canPurge}
        />
      )}
    />
  );
}
