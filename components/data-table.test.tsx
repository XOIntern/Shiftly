import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// DataTable reads its URL state (search/sort/filters) behind next/navigation
// hooks; SSR only needs them to exist, not to navigate.
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/requests",
  useSearchParams: () => new URLSearchParams(),
}));

import { createColumnHelper } from "@tanstack/react-table";

import { DataTable } from "./data-table";
import { dataTableFeatures } from "./data-table-features";

type TestRow = { id: string; name: string };

const helper = createColumnHelper<typeof dataTableFeatures, TestRow>();

const columns = helper.columns([
  helper.accessor("name", {
    header: "Name",
  }),
]);
const rows: TestRow[] = [{ id: "row-1", name: "Row One" }];

function renderTable(options: {
  searchable?: boolean;
  filters?: ReactNode;
}) {
  return renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={rows}
      pageCount={1}
      total={rows.length}
      {...(options.searchable === undefined ? {} : { searchable: options.searchable })}
      {...(options.filters ? { filters: options.filters } : {})}
    />,
  );
}

// #133: the requests table lost its only searchable column, so a table must
// be able to opt out of the toolbar search while every other table keeps it.
describe("DataTable searchable opt-out", () => {
  test("the search box renders by default", () => {
    const html = renderTable({});

    expect(html.includes('aria-label="Search table"')).toBeTrue();
  });

  test("searchable={false} hides the search box only", () => {
    const html = renderTable({
      searchable: false,
      filters: <button type="button">Filter Strip</button>,
    });

    expect(html.includes('aria-label="Search table"')).toBeFalse();
    // Filters still render when the search is opted out.
    expect(html.includes("Filter Strip")).toBeTrue();
  });
});
