"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";

import { deleteBulk, setActiveBulk } from "@/app/(dashboard)/sites/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import {
  SiteRowActions,
  type SiteRow,
} from "@/components/site-form";

const helper = createColumnHelper<typeof dataTableFeatures, SiteRow>();

// Module scope: useTable requires stable columns across renders.
const columns = helper.columns([
  helper.accessor("name", {
    header: "Name",
    meta: { thClassName: "min-w-[160px]", tdClassName: "font-medium" },
  }),
  helper.accessor("isActive", {
    header: "Status",
    // Search should match names, not boolean accessors.
    enableGlobalFilter: false,
    meta: { thClassName: "min-w-[100px]" },
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
    cell: (info) => <SiteRowActions site={info.row.original} />,
  }),
]);

export function SitesTable({ sites }: { sites: SiteRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={sites}
      emptyMessage="No sites yet — add the first one."
      getRowId={(row) => row.id}
      selectionToolbar={({ count, ids, clear }) => (
        <BulkToolbar
          entityName="site"
          count={count}
          clear={clear}
          onActivate={() => setActiveBulk(ids, true)}
          onDeactivate={() => setActiveBulk(ids, false)}
          onDelete={() => deleteBulk(ids)}
        />
      )}
    />
  );
}
