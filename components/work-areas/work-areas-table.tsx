"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  deleteBulk,
  setActiveBulk,
} from "@/app/dashboard/work-areas/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import { StatusBadge } from "@/components/status-badge";
import {
  WorkAreaRowActions,
  type DepartmentOption,
  type SiteLocationOption,
  type WorkAreaRow,
} from "@/components/work-areas/work-area-form";

const helper = createColumnHelper<typeof dataTableFeatures, WorkAreaRow>();

export function WorkAreasTable({
  workAreas,
  departments,
  siteLocations,
  pinnedLocationName,
  showSiteFilter,
  sites,
  pageCount,
  total,
}: {
  workAreas: WorkAreaRow[];
  departments: DepartmentOption[];
  siteLocations: SiteLocationOption[];
  // An admin actor's pinned location name (their binding) — threaded into
  // the row dialogs; undefined for ho/superadmin.
  pinnedLocationName?: string;
  showSiteFilter: boolean;
  sites: Array<{ id: string; name: string }>;
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
        helper.accessor("departmentName", {
          header: "Department",
          meta: { thClassName: "min-w-[160px]", sortable: true },
        }),
        helper.accessor("name", {
          header: "Work area",
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
            <WorkAreaRowActions
              workArea={info.row.original}
              departments={departments}
              siteLocations={siteLocations}
              pinnedLocationName={pinnedLocationName}
            />
          ),
        }),
      ]),
    [departments, siteLocations, pinnedLocationName],
  );

  return (
    <DataTable
      columns={columns}
      data={workAreas}
      pageCount={pageCount}
      total={total}
      emptyMessage="No work areas yet."
      getRowId={(row) => row.id}
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
        </>
      }
      selectionToolbar={({ count, ids, rows, clear }) => (
        <BulkToolbar
          entityName="work area"
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
