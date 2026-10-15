"use client";

import { useState } from "react";
import {
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpDownIcon,
  SearchIcon,
} from "lucide-react";

import { dataTableFeatures, type DataTableFeatures } from "@/components/data-table-features";
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
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  emptyMessage = "No results.",
  placeholder = "Search…",
}: DataTableProps<TData>) {
  const table = useTable({ features: dataTableFeatures, columns, data });
  const [search, setSearch] = useState("");

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
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
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
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
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
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
