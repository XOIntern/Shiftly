import {
  rowSelectionFeature,
  tableFeatures,
} from "@tanstack/react-table";

// Built once at module scope: useTable requires stable features/columns/data
// inputs (TanStack Table v9 getting-started guide). Selection is the only
// interactive feature — search, sort, and pagination live in the URL and
// are owned by the server (epic #24).
export const dataTableFeatures = tableFeatures({
  rowSelectionFeature,
  // Type-only slot declaring per-column render metadata (alignment/widths)
  // plus the URL-sortable flag read by DataTable's TableHead.
  columnMeta: {} as {
    thClassName?: string;
    tdClassName?: string;
    sortable?: boolean;
  },
});

// The feature-map type cannot be spelled, only derived — so it is exported
// beside the runtime value it comes from instead of a types/ module.
export type DataTableFeatures = typeof dataTableFeatures;
