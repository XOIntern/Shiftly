"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import {
  purgeBulk,
  purgeWorkArea,
  restoreBulk,
  restoreWorkArea,
} from "@/app/dashboard/work-areas/actions";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedBulkToolbar } from "@/components/deleted-bulk-toolbar";
import { DeletedListFilter } from "@/components/deleted-list-filter";
import { DeletedRowActions } from "@/components/deleted-row-actions";
import { SiteFilter } from "@/components/sites/site-filter";
import { StatusFilter } from "@/components/status-filter";
import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "@/components/work-areas/purge-copy";
import { nounFor } from "@/lib/bulk-summary";
import type { SiteOption } from "@/types/site";
import type { DeletedWorkAreaRow } from "@/types/work-area";

const helper = createColumnHelper<
  typeof dataTableFeatures,
  DeletedWorkAreaRow
>();

const workAreaNoun = nounFor("work area");

// Restore is open to every role that reaches the page, inside its own scope;
// permanent delete is a superadmin tool, so canPurge hides it for the rest
// instead of leaving a control that can only fail.
export function DeletedWorkAreasTable({
  workAreas,
  showSiteFilter,
  sites,
  canPurge,
  pageCount,
  total,
}: {
  workAreas: DeletedWorkAreaRow[];
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
        helper.accessor("siteName", {
          header: "Site",
          meta: { thClassName: "min-w-[160px]", sortable: true },
        }),
        helper.accessor("locationName", {
          header: "Location",
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
            const { id, name } = info.row.original;
            return (
              <DeletedRowActions
                name={name}
                restore={() => restoreWorkArea(id)}
                purge={() => purgeWorkArea(id)}
                purgeDescription={purgeDescription(name)}
                purgeSuccess={purgeSuccessMessage(name)}
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
      data={workAreas}
      pageCount={pageCount}
      total={total}
      emptyMessage="No deleted work areas."
      filters={
        <>
          {showSiteFilter ? <SiteFilter sites={sites} /> : null}
          <StatusFilter />
          <DeletedListFilter singular="work area" />
        </>
      }
      getRowId={(row) => row.id}
      selectionToolbar={({ count, ids, clear }) => (
        <DeletedBulkToolbar
          count={count}
          ids={ids}
          clear={clear}
          noun={workAreaNoun}
          restore={restoreBulk}
          purge={purgeBulk}
          bulkPurgeDescription={bulkPurgeDescription}
          canPurge={canPurge}
        />
      )}
    />
  );
}
