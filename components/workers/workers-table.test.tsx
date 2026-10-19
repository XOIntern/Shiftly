import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The table renders client-side URL state (search/sort/filters) behind
// next/navigation hooks; Marko SSR only needs them to exist, not to navigate.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/workers",
  useSearchParams: () => new URLSearchParams(),
}));

import type {
  PositionRow,
  SiteOption,
  SiteLocationOption,
  WorkerRow,
} from "@/types/forms";
import { WorkersTable } from "./workers-table";

// No DB — the table is pure presentation over the options and rows the page
// threads in; the bulk actions are wired but never invoked by static markup.
const SITE_A = "11111111-1111-1111-1111-111111111111";
const LOC_A1 = "aaaaaaaa-1111-1111-1111-111111111111";
const POS_A1 = "aaaaaaaa-1111-1111-1111-111111111111";

const sites: SiteOption[] = [{ id: SITE_A, name: "Site Alpha" }];
const siteLocations: SiteLocationOption[] = [
  { id: LOC_A1, name: "Loc Alpha One", siteId: SITE_A },
];
const positions: PositionRow[] = [
  {
    id: POS_A1,
    name: "Position Alpha One",
    isActive: true,
    siteId: SITE_A,
    siteName: "Site Alpha",
  },
];

const worker: WorkerRow = {
  id: "cccccccc-1111-1111-1111-111111111111",
  employeeId: "EMP-001",
  name: "Budi Santoso",
  isActive: true,
  contractEndDate: "2027-12-31",
  siteLocationId: LOC_A1,
  positionId: POS_A1,
  siteId: SITE_A,
  siteName: "Site Alpha",
  locationName: "Loc Alpha One",
  positionName: "Position Alpha One",
};

function renderTable(props: {
  workers: WorkerRow[];
  total?: number;
  showSiteFilter?: boolean;
}) {
  return renderToStaticMarkup(
    <WorkersTable
      workers={props.workers}
      showSiteFilter={props.showSiteFilter ?? true}
      sites={sites}
      siteLocations={siteLocations}
      positions={positions}
      pageCount={1}
      total={props.total ?? props.workers.length}
    />,
  );
}

describe("WorkersTable static markup", () => {
  test("renders the employee id and the joined names of a worker row", () => {
    const html = renderTable({ workers: [worker] });

    expect(html).toContain("EMP-001");
    expect(html).toContain("Budi Santoso");
    expect(html).toContain("Loc Alpha One");
    expect(html).toContain("Position Alpha One");
  });

  test("shows the empty message when the page has no workers", () => {
    const html = renderTable({ workers: [], total: 0 });

    expect(html).toContain("No workers yet.");
  });
});
