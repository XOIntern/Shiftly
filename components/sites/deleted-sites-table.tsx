"use client";

import { createColumnHelper } from "@tanstack/react-table";

import {
  purgeBulk,
  purgeSite,
  restoreBulk,
  restoreSite,
} from "@/app/dashboard/sites/actions";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedBulkToolbar } from "@/components/deleted-bulk-toolbar";
import { DeletedListFilter } from "@/components/deleted-list-filter";
import { DeletedRowActions } from "@/components/deleted-row-actions";
import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "@/components/sites/purge-copy";
import { StatusFilter } from "@/components/status-filter";
import { nounFor } from "@/lib/bulk-summary";
import type { DeletedSiteRow } from "@/types/site";

const helper = createColumnHelper<typeof dataTableFeatures, DeletedSiteRow>();

// Module scope: useTable requires stable columns across renders.
const columns = helper.columns([
  helper.accessor("name", {
    header: "Name",
    meta: {
      thClassName: "min-w-[160px]",
      tdClassName: "font-medium",
      sortable: true,
    },
  }),
  helper.accessor("deletedAt", {
    header: "Deleted",
    meta: { thClassName: "min-w-[120px]", sortable: true },
    // YYYY-MM-DD from the ISO string: no locale or timezone work, so the
    // server and the client print the same thing.
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
          restore={() => restoreSite(id)}
          purge={() => purgeSite(id)}
          purgeDescription={purgeDescription(name)}
          purgeSuccess={purgeSuccessMessage(name)}
          canPurge
        />
      );
    },
  }),
]);

const siteNoun = nounFor("site");

export function DeletedSitesTable({
  sites,
  pageCount,
  total,
}: {
  sites: DeletedSiteRow[];
  pageCount: number;
  total: number;
}) {
  return (
    <DataTable
      columns={columns}
      data={sites}
      pageCount={pageCount}
      total={total}
      emptyMessage="No deleted sites."
      filters={
        <>
          <StatusFilter />
          <DeletedListFilter singular="site" plural="sites" />
        </>
      }
      getRowId={(row) => row.id}
      selectionToolbar={({ count, ids, clear }) => (
        <DeletedBulkToolbar
          count={count}
          ids={ids}
          clear={clear}
          noun={siteNoun}
          restore={restoreBulk}
          purge={purgeBulk}
          bulkPurgeDescription={bulkPurgeDescription}
          canPurge
        />
      )}
    />
  );
}
