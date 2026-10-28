"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedListFilter } from "@/components/deleted-list-filter";
import { StatusBadge } from "@/components/status-badge";
import { StatusFilter } from "@/components/status-filter";
import { ShiftRowActions } from "@/app/dashboard/shifts/shift-dialog";
import type { SiteLocationOption, SiteOption } from "@/types/site";
import type { ShiftRow } from "@/types/shift";

const helper = createColumnHelper<typeof dataTableFeatures, ShiftRow>();

export function ShiftsTable({
  shifts,
  siteLocations,
  sites,
  pinnedLocationName,
  canManage,
  showSite,
  showLocation,
  pageCount,
  total,
}: {
  shifts: ShiftRow[];
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  // An admin actor's pinned location name (their binding) — threaded into
  // the row dialogs; undefined for ho/superadmin.
  pinnedLocationName?: string;
  // All three roles manage shifts within their scope (spec §3.1); false
  // renders rows only, with no create entry and no row actions.
  canManage: boolean;
  // Site/location columns only carry information where the actor's scope
  // spans more than one of them: the location column for ho/superadmin,
  // the site column for superadmin alone (spec §3.1).
  showSite: boolean;
  showLocation: boolean;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns; the edit dialog needs the options.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("orderIndex", {
          header: "Order",
          meta: { thClassName: "w-16", tdClassName: "tabular-nums", sortable: true },
        }),
        helper.accessor("label", {
          header: "Shift",
          meta: {
            thClassName: "min-w-[160px]",
            tdClassName: "font-medium",
            sortable: true,
          },
        }),
        helper.accessor("startTime", {
          header: "Time",
          meta: { thClassName: "min-w-[120px]", sortable: true },
          cell: (info) => (
            <span className="tabular-nums">
              {info.getValue()} – {info.row.original.endTime}
            </span>
          ),
        }),
        helper.accessor("isActive", {
          header: "Status",
          meta: { thClassName: "min-w-[100px]", sortable: true },
          cell: (info) => <StatusBadge isActive={info.getValue()} />,
        }),
        ...(showSite
          ? [
              helper.accessor("siteName", {
                header: "Site",
                meta: { thClassName: "min-w-[160px]" },
              }),
            ]
          : []),
        ...(showLocation
          ? [
              helper.accessor("locationName", {
                header: "Location",
                meta: { thClassName: "min-w-[160px]" },
              }),
            ]
          : []),
        ...(canManage
          ? [
              helper.display({
                id: "actions",
                header: "Actions",
                meta: {
                  thClassName: "min-w-[100px] text-right",
                  tdClassName: "text-right",
                },
                cell: (info) => (
                  <ShiftRowActions
                    shift={info.row.original}
                    siteLocations={siteLocations}
                    sites={sites}
                    pinnedLocationName={pinnedLocationName}
                  />
                ),
              }),
            ]
          : []),
      ]),
    [siteLocations, sites, pinnedLocationName, canManage, showSite, showLocation],
  );

  return (
    <DataTable
      columns={columns}
      data={shifts}
      pageCount={pageCount}
      total={total}
      emptyMessage="Create your first shift for this location"
      getRowId={(row) => row.id}
      filters={
        <>
          <StatusFilter />
          <DeletedListFilter singular="shift" plural="shifts" />
        </>
      }
    />
  );
}
