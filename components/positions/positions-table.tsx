"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  deleteBulk,
  setActiveBulk,
} from "@/app/dashboard/positions/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedListFilter } from "@/components/deleted-list-filter";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import { StatusBadge } from "@/components/status-badge";
import { PositionRowActions } from "@/components/positions/position-form";
import type { PositionRow } from "@/types/position";

const helper = createColumnHelper<typeof dataTableFeatures, PositionRow>();

export function PositionsTable({
  positions,
  showSiteFilter,
  sites,
  pinnedSiteName,
  pageCount,
  total,
}: {
  positions: PositionRow[];
  showSiteFilter: boolean;
  sites: Array<{ id: string; name: string }>;
  // An admin actor's pinned site name (their binding's) — threaded into
  // the row dialogs; undefined for ho/superadmin.
  pinnedSiteName?: string;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns; the edit dialog needs the options.
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
          cell: (info) => (
            <PositionRowActions
              position={info.row.original}
              sites={sites}
              pinnedSiteName={pinnedSiteName}
            />
          ),
        }),
      ]),
    [sites, pinnedSiteName],
  );

  return (
    <DataTable
      columns={columns}
      data={positions}
      pageCount={pageCount}
      total={total}
      emptyMessage="No positions yet."
      getRowId={(row) => row.id}
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
          <DeletedListFilter singular="position" plural="positions" />
        </>
      }
      selectionToolbar={({ count, ids, rows, clear }) => (
        <BulkToolbar
          entityName="position"
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
