"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  purgeBulk,
  purgePosition,
  restoreBulk,
  restorePosition,
} from "@/app/dashboard/positions/actions";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedBulkToolbar } from "@/components/deleted-bulk-toolbar";
import { DeletedListFilter } from "@/components/deleted-list-filter";
import { DeletedRowActions } from "@/components/deleted-row-actions";
import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "@/components/positions/purge-copy";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import { nounFor } from "@/lib/bulk-summary";
import type { DeletedPositionRow } from "@/types/position";
import type { SiteOption } from "@/types/site";

const helper = createColumnHelper<
  typeof dataTableFeatures,
  DeletedPositionRow
>();

const positionNoun = nounFor("position");

// Restore is open to every role that reaches the page, inside its own scope;
// permanent delete is a superadmin tool, so canPurge hides it for the rest
// instead of leaving a control that can only fail.
export function DeletedPositionsTable({
  positions,
  showSiteFilter,
  sites,
  canPurge,
  pageCount,
  total,
}: {
  positions: DeletedPositionRow[];
  showSiteFilter: boolean;
  sites: SiteOption[];
  canPurge: boolean;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns across renders.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]", sortable: true },
        }),
        helper.accessor("name", {
          header: "Position",
          meta: {
            thClassName: "min-w-[160px]",
            tdClassName: "font-medium",
            sortable: true,
          },
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
                restore={() => restorePosition(id)}
                purge={() => purgePosition(id)}
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
      data={positions}
      pageCount={pageCount}
      total={total}
      emptyMessage="No deleted positions."
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
          <DeletedListFilter singular="position" />
        </>
      }
      getRowId={(row) => row.id}
      selectionToolbar={({ count, ids, clear }) => (
        <DeletedBulkToolbar
          count={count}
          ids={ids}
          clear={clear}
          noun={positionNoun}
          restore={restoreBulk}
          purge={purgeBulk}
          bulkPurgeDescription={bulkPurgeDescription}
          canPurge={canPurge}
        />
      )}
    />
  );
}
