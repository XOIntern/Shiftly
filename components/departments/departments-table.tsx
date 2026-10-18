"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  deleteBulk,
  setActiveBulk,
} from "@/app/dashboard/departments/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import { StatusBadge } from "@/components/status-badge";
import {
  DepartmentRowActions,
  type DepartmentRow,
  type SiteOption,
} from "@/components/departments/department-form";

const helper = createColumnHelper<typeof dataTableFeatures, DepartmentRow>();

export function DepartmentsTable({
  departments,
  sites,
  canManage,
  showSiteFilter,
  pageCount,
  total,
}: {
  departments: DepartmentRow[];
  sites: SiteOption[];
  canManage: boolean;
  showSiteFilter: boolean;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns. An admin is view-only: no Actions
  // column; DataTable drops its selection checkbox when the selection
  // toolbar is absent, so no selection either.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]", sortable: true },
        }),
        helper.accessor("name", {
          header: "Department",
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
        ...(canManage
          ? [
              helper.display({
                id: "actions",
                header: "Actions",
                meta: {
                  thClassName: "min-w-[180px] text-right",
                  tdClassName: "text-right",
                },
                cell: (info) => (
                  <DepartmentRowActions department={info.row.original} />
                ),
              }),
            ]
          : []),
      ]),
    [canManage],
  );

  return (
    <DataTable
      columns={columns}
      data={departments}
      pageCount={pageCount}
      total={total}
      emptyMessage="No departments yet."
      getRowId={(row) => row.id}
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
        </>
      }
      selectionToolbar={
        canManage
          ? ({ count, ids, rows, clear }) => (
              <BulkToolbar
                entityName="department"
                count={count}
                clear={clear}
                onActivate={() => setActiveBulk(ids, true)}
                onDeactivate={() => setActiveBulk(ids, false)}
                onDelete={() => deleteBulk(ids)}
                selectedStatuses={rows.map((row) => row.isActive)}
              />
            )
          : undefined
      }
    />
  );
}
