"use client";

import { useState, useTransition } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { EllipsisIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { purgeSite, restoreSite } from "@/app/dashboard/sites/actions";
import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import { DeletedSitesToolbar } from "@/components/sites/deleted-sites-toolbar";
import { purgeDescription } from "@/components/sites/purge-copy";
import { SitesListFilter } from "@/components/sites/sites-list-filter";
import { StatusFilter } from "@/components/status-filter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GENERIC_ERROR } from "@/lib/action-state";
import type { DeletedSiteRow } from "@/types/site";

const helper = createColumnHelper<typeof dataTableFeatures, DeletedSiteRow>();

function DeletedSiteRowActions({ site }: { site: DeletedSiteRow }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Restore runs at once: deleting the site again undoes it.
  function handleRestore() {
    startTransition(async () => {
      const result = await restoreSite(site.id);
      if (result.ok) {
        toast.success(`“${site.name}” restored`);
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${site.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={pending} onClick={handleRestore}>
            <RotateCcwIcon />
            Restore
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setOpen(true)}>
            <Trash2Icon />
            Delete permanently
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialog lives outside the menu popup so the menu can
      close before its layer opens. */}
      <PurgeSiteDialog site={site} open={open} onOpenChange={setOpen} />
    </DropdownMenu>
  );
}

function PurgeSiteDialog({
  site,
  open,
  onOpenChange,
}: {
  site: DeletedSiteRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await purgeSite(site.id);
      if (result.ok) {
        onOpenChange(false);
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete permanently</AlertDialogTitle>
          <AlertDialogDescription>
            {purgeDescription(site.name)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Module scope: useTable requires stable columns across renders.
const columns = helper.columns([
  helper.accessor("name", {
    header: "Name",
    meta: {
      thClassName: "min-w-[160px]",
      tdClassName: "font-medium",
      sortable: true,
    },
  }),
  helper.accessor("deletedAt", {
    header: "Deleted",
    meta: { thClassName: "min-w-[120px]", sortable: true },
    // YYYY-MM-DD from the ISO string: no locale or timezone work, so the
    // server and the client print the same thing.
    cell: (info) => info.getValue().slice(0, 10),
  }),
  helper.display({
    id: "actions",
    header: "Actions",
    meta: {
      thClassName: "min-w-[100px] text-right",
      tdClassName: "text-right",
    },
    cell: (info) => <DeletedSiteRowActions site={info.row.original} />,
  }),
]);

export function DeletedSitesTable({
  sites,
  pageCount,
  total,
}: {
  sites: DeletedSiteRow[];
  pageCount: number;
  total: number;
}) {
  return (
    <DataTable
      columns={columns}
      data={sites}
      pageCount={pageCount}
      total={total}
      emptyMessage="No deleted sites."
      filters={
        <>
          <StatusFilter />
          <SitesListFilter />
        </>
      }
      getRowId={(row) => row.id}
      selectionToolbar={({ count, ids, clear }) => (
        <DeletedSitesToolbar count={count} ids={ids} clear={clear} />
      )}
    />
  );
}
