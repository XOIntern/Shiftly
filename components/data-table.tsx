"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  SearchIcon,
} from "lucide-react";

import {
  parseTableSearchParams,
  TABLE_PAGE_SIZE,
} from "@/lib/table-params";
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
import { cn } from "cn";

// Follows the shared data-table pattern: TanStack Table v9 owns row models
// and selection state; the shadcn Table primitives own the markup. Search,
// sort, and pagination live in the URL — the server holds one page at a
// time (epic #24), so this component only reads and pushes URL state.
interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<DataTableFeatures, TData>[];
  /** Exactly one server page of rows. */
  data: TData[];
  /** Server-computed page count and filtered-row count behind the URL state. */
  pageCount: number;
  total: number;
  /** Shown when the filtered set is empty with no search in the URL. */
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

function buildParams(searchParams: URLSearchParams) {
  return new URLSearchParams(searchParams.toString());
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  pageCount,
  total,
  emptyMessage = "No results.",
  placeholder = "Search…",
  getRowId,
  canSelectRow,
  selectionToolbar,
}: DataTableProps<TData>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { q, page, sort } = parseTableSearchParams(
    Object.fromEntries(searchParams.entries()),
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    enableRowSelection: canSelectRow
      ? (row: Row<DataTableFeatures, TData>) => canSelectRow(row.original)
      : true,
  });

  const [input, setInput] = useState(q);
  const lastPushed = useRef(q);
  const [isPending, startTransition] = useTransition();

  const pushUrl = (params: URLSearchParams, method: "replace" | "push") => {
    const query = params.toString();
    startTransition(() => {
      const href = `${pathname}${query ? `?${query}` : ""}`;
      router[method](href, { scroll: false });
    });
  };

  // Typing: 300 ms debounce, pushed as a replace (no history spam). A
  // search always restarts at page 1 while preserving sort/dir.
  useEffect(() => {
    if (input === q) return;
    const timer = setTimeout(() => {
      lastPushed.current = input;
      const params = buildParams(searchParams);
      if (input) {
        params.set("q", input);
      } else {
        params.delete("q");
      }
      params.set("page", "1");
      pushUrl(params, "replace");
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Back/forward or a deep link changes the URL's q without a push from
  // here — adopt the URL value unless it is the one just pushed.
  useEffect(() => {
    if (q !== lastPushed.current) {
      lastPushed.current = q;
      setInput(q);
    }
  }, [q]);

  // Selection is page-scoped (locked decision 1): any URL state change
  // drops it, so the toolbar can never act on rows beyond the current page.
  // Deps are primitives — `sort` is a fresh object per render.
  useEffect(() => {
    table.resetRowSelection(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, page, sort?.columnId, sort?.dir]);

  const rows = table.getRowModel().rows;

  // Loaded selection only: ids lingering in state after a page change have
  // no row object here, so the toolbar can never act on them.
  const selectedIds = table.getSelectedRowModel().rows.map((row) => row.id);
  const allSelected = table.getIsAllRowsSelected();
  const someSelected = table.getIsSomeRowsSelected();

  const pageFrom = (page - 1) * TABLE_PAGE_SIZE + 1;
  const pageTo = Math.min(page * TABLE_PAGE_SIZE, total);
  const showPagination = pageCount > 1 || total > TABLE_PAGE_SIZE;
  const goToPage = (target: number) => {
    const params = buildParams(searchParams);
    params.set("page", String(target));
    pushUrl(params, "push");
  };

  const toggleSort = (columnId: string) => {
    const params = buildParams(searchParams);
    params.set("page", "1");
    if (sort?.columnId !== columnId) {
      params.set("sort", columnId);
      params.set("dir", "asc");
    } else if (sort.dir === "asc") {
      params.set("dir", "desc");
    } else {
      // Cycle third stop: back to the default order.
      params.delete("sort");
      params.delete("dir");
    }
    pushUrl(params, "push");
  };

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
            value={input}
            onChange={(event) => setInput(event.target.value)}
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
      <div
        aria-busy={isPending}
        className={cn(
          isPending && "opacity-60 pointer-events-none select-none",
        )}
      >
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
                  const sortable = !!column.columnDef.meta?.sortable;
                  const sortDirection =
                    sort?.columnId === column.id ? sort.dir : null;

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
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.id)}
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
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cell.column.columnDef.meta?.tdClassName}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : q ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (selectionToolbar ? 1 : 0)}
                  className="h-24 text-center text-muted-foreground"
                >
                  {`No results for "${q}".`}
                </TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (selectionToolbar ? 1 : 0)}
                  className="h-24 text-center text-muted-foreground"
                >
                  {total === 0 ? emptyMessage : "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {showPagination ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="First page"
                disabled={page === 1}
                onClick={() => goToPage(1)}
                className="cursor-pointer rounded-md p-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronsLeftIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => goToPage(page - 1)}
                className="cursor-pointer rounded-md p-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronLeftIcon className="size-4" />
              </button>
            </div>
            <span className="text-sm text-muted-foreground">
              {pageFrom}–{pageTo} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pageCount}
                onClick={() => goToPage(page + 1)}
                className="cursor-pointer rounded-md p-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronRightIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Last page"
                disabled={page >= pageCount}
                onClick={() => goToPage(pageCount)}
                className="cursor-pointer rounded-md p-2 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronsRightIcon className="size-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
