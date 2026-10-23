"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import { deleteBulk, setActiveBulk } from "@/app/dashboard/locations/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import { StatusBadge } from "@/components/status-badge";
import { LocationRowActions } from "@/components/locations/location-form";
import type { LocationRow } from "@/types/location";
import type { SiteOption } from "@/types/site";

const helper = createColumnHelper<typeof dataTableFeatures, LocationRow>();

export function LocationsTable({
  locations,
  sites,
  showSiteFilter,
  pageCount,
  total,
}: {
  locations: LocationRow[];
  sites: SiteOption[];
  showSiteFilter: boolean;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns; the edit dialog needs the site options.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]", sortable: true },
        }),
        helper.accessor("name", {
          header: "Location",
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
            <LocationRowActions location={info.row.original} sites={sites} />
          ),
        }),
      ]),
    [sites],
  );

  return (
    <DataTable
      columns={columns}
      data={locations}
      pageCount={pageCount}
      total={total}
      emptyMessage="No locations yet."
      getRowId={(row) => row.id}
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
        </>
      }
      selectionToolbar={({ count, ids, rows, clear }) => (
        <BulkToolbar
          entityName="location"
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
