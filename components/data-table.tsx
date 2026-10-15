"use client";

import { useState, type ReactNode } from "react";
import {
  useTable,
  type ColumnDef,
  type Row,
  type RowData,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpDownIcon,
  SearchIcon,
} from "lucide-react";

import { dataTableFeatures, type DataTableFeatures } from "@/components/data-table-features";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Follows the shared data-table pattern: TanStack Table v9 owns row models
// and state; the shadcn Table primitives own the markup.
interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<DataTableFeatures, TData>[];
  data: TData[];
  /** Shown when the incoming data itself is empty (vs. filtered away). */
  emptyMessage?: string;
  placeholder?: string;
  /** Stable application id per row — required so selection survives
   * re-sorts, filters, and revalidation refreshes (index ids would remap
   * onto whatever row lands at that position). */
  getRowId?: (row: TData, index: number) => string;
  /** Per-row opt-out: unselectable rows render no checkbox. */
  canSelectRow?: (row: TData) => boolean;
  /** Rendered in the toolbar strip when at least one row is selected. */
  selectionToolbar?: (selection: {
    count: number;
    ids: string[];
    clear: () => void;
  }) => ReactNode;
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage = "No results.",
  placeholder = "Search…",
  getRowId,
  canSelectRow,
  selectionToolbar,
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    enableRowSelection: canSelectRow
      ? (row: Row<DataTableFeatures, TData>) => canSelectRow(row.original)
      : true,
  });
  const [search, setSearch] = useState("");

  const rows = table.getRowModel().rows;

  // Loaded selection only: ids lingering in state after a refresh or
  // filter change have no row object here, so the toolbar can never act
  // on them. clear() nukes the state itself, stale ids included.
  const selectedIds = table.getSelectedRowModel().rows.map((row) => row.id);
  const allSelected = table.getIsAllRowsSelected();
  const someSelected = table.getIsSomeRowsSelected();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search table"
            placeholder={placeholder}
            value={search}
            onChange={(event) => {
              table.setGlobalFilter(event.target.value);
              setSearch(event.target.value);
            }}
          />
        </InputGroup>
        {selectedIds.length > 0 && selectionToolbar
          ? selectionToolbar({
              count: selectedIds.length,
              ids: selectedIds,
              clear: () => table.resetRowSelection(true),
            })
          : null}
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {selectionToolbar ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all rows"
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onCheckedChange={() => table.toggleAllRowsSelected()}
                  />
                </TableHead>
              ) : null}
              {headerGroup.headers.map((header) => {
                const column = header.column;
                const canSort = column.getCanSort();
                const sortDirection = column.getIsSorted();

                return (
                  <TableHead
                    key={header.id}
                    className={column.columnDef.meta?.thClassName}
                    aria-sort={
                      sortDirection === "asc"
                        ? "ascending"
                        : sortDirection === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={column.getToggleSortingHandler()}
                        className="flex cursor-pointer items-center gap-1 text-start"
                      >
                        <table.FlexRender header={header} />
                        {sortDirection === "asc" ? (
                          <ArrowUpIcon className="size-3.5 opacity-70" />
                        ) : sortDirection === "desc" ? (
                          <ArrowDownIcon className="size-3.5 opacity-70" />
                        ) : (
                          <ArrowUpDownIcon className="size-3.5 opacity-30" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow key={row.id}>
                {selectionToolbar ? (
                  <TableCell>
                    {row.getCanSelect() && (
                      <Checkbox
                        aria-label={`Select row ${row.id}`}
                        checked={row.getIsSelected()}
                        onCheckedChange={(checked) =>
                          row.toggleSelected(checked)
                        }
                      />
                    )}
                  </TableCell>
                ) : null}
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.columnDef.meta?.tdClassName}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selectionToolbar ? 1 : 0)}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selectionToolbar ? 1 : 0)}
                className="h-24 text-center text-muted-foreground"
              >
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
