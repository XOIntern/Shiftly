"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  deleteBulk,
  setActiveBulk,
} from "@/app/dashboard/workers/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import { StatusBadge } from "@/components/status-badge";
import { WorkerRowActions } from "@/components/workers/worker-form";
import type {
  PositionRow,
  SiteLocationOption,
  SiteOption,
  WorkerRow,
} from "@/types/forms";

const helper = createColumnHelper<typeof dataTableFeatures, WorkerRow>();

export function WorkersTable({
  workers,
  showSiteFilter,
  sites,
  siteLocations,
  positions,
  pinnedLocationName,
  pageCount,
  total,
}: {
  workers: WorkerRow[];
  showSiteFilter: boolean;
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  positions: PositionRow[];
  // An admin actor's pinned location name (their binding's) — threaded into
  // the row dialogs; undefined for ho/superadmin.
  pinnedLocationName?: string;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns; the row dialogs need the options.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("employeeId", {
          header: "Employee ID",
          meta: {
            thClassName: "min-w-[140px]",
            tdClassName: "font-medium",
            sortable: true,
          },
        }),
        helper.accessor("name", {
          header: "Name",
          meta: { thClassName: "min-w-[160px]", sortable: true },
        }),
        helper.accessor("locationName", {
          header: "Location",
          meta: { thClassName: "min-w-[160px]" },
        }),
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]", sortable: true },
        }),
        helper.display({
          id: "positions",
          header: "Position",
          meta: { thClassName: "min-w-[160px]" },
          // The whole qualification set: alphabetical, comma joined. Not
          // sortable — positionName never was either.
          cell: (info) =>
            info.row.original.positions.map((position) => position.name).join(", ") ||
            "–",
        }),
        helper.accessor("contractEndDate", {
          header: "Contract end",
          meta: { thClassName: "min-w-[140px]", sortable: true },
          cell: (info) => info.getValue() ?? "–",
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
            <WorkerRowActions
              worker={info.row.original}
              sites={sites}
              siteLocations={siteLocations}
              positions={positions}
              pinnedLocationName={pinnedLocationName}
            />
          ),
        }),
      ]),
    [sites, siteLocations, positions, pinnedLocationName],
  );

  return (
    <DataTable
      columns={columns}
      data={workers}
      pageCount={pageCount}
      total={total}
      emptyMessage="No workers yet."
      getRowId={(row) => row.id}
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
        </>
      }
      selectionToolbar={({ count, ids, rows, clear }) => (
        <BulkToolbar
          entityName="worker"
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
