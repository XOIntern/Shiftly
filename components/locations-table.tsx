"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

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
}: {
  locations: LocationRow[];
  sites: SiteOption[];
}) {
  // useTable requires stable columns; the edit dialog needs the site options.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Location",
          meta: { thClassName: "min-w-[160px]", tdClassName: "font-medium" },
        }),
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]" },
        }),
        helper.accessor("address", {
          header: "Address",
          meta: { thClassName: "min-w-[160px]" },
        }),
        helper.accessor("isActive", {
          header: "Status",
          // Search should match names/addresses, not boolean accessors.
          enableGlobalFilter: false,
          meta: { thClassName: "min-w-[100px]" },
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
      emptyMessage="No locations yet — add the first one for a site."
    />
  );
}
