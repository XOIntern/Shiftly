import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

// Built once at module scope: useTable requires stable features/columns/data
// inputs (TanStack Table v9 getting-started guide). The slots enable
// click-to-sort headers and the search box's includesString global filter;
// global filtering requires column filtering, and both require a filtered
// row model. Core row models are wired by the table itself.
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  // Type-only slot declaring per-column render metadata (alignment/widths)
  // read by DataTable's TableHead/TableCell.
  columnMeta: {} as {
    thClassName?: string;
    tdClassName?: string;
  },
});

export type DataTableFeatures = typeof dataTableFeatures;
