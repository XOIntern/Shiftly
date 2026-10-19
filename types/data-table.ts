// The one types/ module with a value import: DataTableFeatures is derived
// from the runtime feature-map value dataTableFeatures, which stays in
// components/data-table-features.ts (only the type moves per the plan), so
// the type can only be expressed as typeof dataTableFeatures.
import { dataTableFeatures } from "@/components/data-table-features";

import type { SortDir } from "@/lib/table-params";

// One sort key: a column id plus its direction. Whitelisting the column
// id happens per page (buildOrder), never here.
export type TableSort = { columnId: string; dir: SortDir };

export type DataTableFeatures = typeof dataTableFeatures;
