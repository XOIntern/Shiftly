"use client";

import { createColumnHelper } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
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
]);

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
      getRowId={(row) => row.id}
    />
  );
}
