"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import { deleteBulk, setActiveBulk } from "@/app/(dashboard)/locations/actions";
import { BulkToolbar } from "@/components/bulk-toolbar";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { Badge } from "@/components/ui/badge";
import {
  LocationRowActions,
  type LocationRow,
  type SiteOption,
} from "@/components/location-form";

const helper = createColumnHelper<typeof dataTableFeatures, LocationRow>();

function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge variant="secondary">Active</Badge>
  ) : (
    <Badge variant="outline" className="px-1.5 text-muted-foreground">
      Inactive
    </Badge>
  );
}

export function LocationsTable({
  locations,
  sites,
  pageCount,
  total,
}: {
  locations: LocationRow[];
  sites: SiteOption[];
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns; the edit dialog needs the site options.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Location",
          meta: {
            thClassName: "min-w-[160px]",
            tdClassName: "font-medium",
            sortable: true,
          },
        }),
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]", sortable: true },
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
            <LocationRowActions
              location={info.row.original}
              sites={sites}
            />
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
      emptyMessage="No locations yet — add the first one for a site."
      getRowId={(row) => row.id}
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
