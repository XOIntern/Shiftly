"use client";

import { createColumnHelper } from "@tanstack/react-table";

import { deleteBulk, setActiveBulk } from "@/app/dashboard/sites/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { StatusFilter } from "@/components/status-filter";
import { StatusBadge } from "@/components/status-badge";
import { SiteRowActions, type SiteRow } from "@/components/sites/site-form";

const helper = createColumnHelper<typeof dataTableFeatures, SiteRow>();

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
  helper.accessor("isActive", {
    header: "Status",
    meta: { thClassName: "min-w-[100px]", sortable: true },
    cell: (info) => <StatusBadge isActive={info.getValue()} />,
  }),
  helper.display({
    id: "actions",
    header: "Actions",
    meta: {
      thClassName: "min-w-[180px] text-right",
      tdClassName: "text-right",
    },
    cell: (info) => <SiteRowActions site={info.row.original} />,
  }),
]);

export function SitesTable({
  sites,
  pageCount,
  total,
}: {
  sites: SiteRow[];
  pageCount: number;
  total: number;
}) {
  return (
    <DataTable
      columns={columns}
      data={sites}
      pageCount={pageCount}
      total={total}
      emptyMessage="No sites yet — add the first one."
      getRowId={(row) => row.id}
      filters={<StatusFilter />}
      selectionToolbar={({ count, ids, rows, clear }) => (
        <BulkToolbar
          entityName="site"
          count={count}
          clear={clear}
          onActivate={() => setActiveBulk(ids, true)}
          onDeactivate={() => setActiveBulk(ids, false)}
          onDelete={() => deleteBulk(ids)}
          selectedStatuses={rows.map((row) => row.isActive)}
        />
      )}
    />
  );
}
