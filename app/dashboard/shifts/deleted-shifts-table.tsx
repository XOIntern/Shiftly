"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  purgeBulk,
  purgeShift,
  restoreBulk,
  restoreShift,
} from "@/app/dashboard/shifts/actions";
import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "@/app/dashboard/shifts/purge-copy";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedBulkToolbar } from "@/components/deleted-bulk-toolbar";
import { DeletedListFilter } from "@/components/deleted-list-filter";
import { DeletedRowActions } from "@/components/deleted-row-actions";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import { nounFor } from "@/lib/bulk-summary";
import type { DeletedShiftRow } from "@/types/shift";
import type { SiteOption } from "@/types/site";

const helper = createColumnHelper<typeof dataTableFeatures, DeletedShiftRow>();

const shiftNoun = nounFor("shift");

// Restore is open to every role that reaches the page, inside its own scope;
// permanent delete is a superadmin tool, so canPurge hides it for the rest
// instead of leaving a control that can only fail.
export function DeletedShiftsTable({
  shifts,
  showSiteFilter,
  sites,
  canPurge,
  pageCount,
  total,
}: {
  shifts: DeletedShiftRow[];
  showSiteFilter: boolean;
  sites: SiteOption[];
  canPurge: boolean;
  pageCount: number;
  total: number;
}) {
  // useTable requires stable columns across renders.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("orderIndex", {
          header: "Order",
          meta: {
            thClassName: "w-16",
            tdClassName: "tabular-nums",
            sortable: true,
          },
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
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]" },
        }),
        helper.accessor("locationName", {
          header: "Location",
          meta: { thClassName: "min-w-[160px]" },
        }),
        helper.accessor("deletedAt", {
          header: "Deleted",
          meta: { thClassName: "min-w-[120px]", sortable: true },
          // YYYY-MM-DD from the ISO string: no locale or timezone work, so
          // the server and the client print the same thing.
          cell: (info) => info.getValue().slice(0, 10),
        }),
        helper.display({
          id: "actions",
          header: "Actions",
          meta: {
            thClassName: "min-w-[100px] text-right",
            tdClassName: "text-right",
          },
          cell: (info) => {
            const { id, label } = info.row.original;
            return (
              <DeletedRowActions
                name={label}
                restore={() => restoreShift(id)}
                purge={() => purgeShift(id)}
                purgeDescription={purgeDescription(label)}
                purgeSuccess={purgeSuccessMessage(label)}
                canPurge={canPurge}
              />
            );
          },
        }),
      ]),
    [canPurge],
  );

  return (
    <DataTable
      columns={columns}
      data={shifts}
      pageCount={pageCount}
      total={total}
      emptyMessage="No deleted shifts."
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
          <DeletedListFilter singular="shift" />
        </>
      }
      getRowId={(row) => row.id}
      selectionToolbar={({ count, ids, clear }) => (
        <DeletedBulkToolbar
          count={count}
          ids={ids}
          clear={clear}
          noun={shiftNoun}
          restore={restoreBulk}
          purge={purgeBulk}
          bulkPurgeDescription={bulkPurgeDescription}
          canPurge={canPurge}
        />
      )}
    />
  );
}
