import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

// DataTable reads its URL state (search/sort/filters) behind next/navigation
// hooks; SSR only needs them to exist, not to navigate.
mock.module("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  // Pages under test may call notFound(); every stub in the repo carries it
  // because bun's module mocks are process-wide and the last registration
  // wins across suites.
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/requests",
  useSearchParams: () => searchParamsHolder.params,
}));

// Late-bound so individual tests can set the URL query before rendering.
const searchParamsHolder: { params: URLSearchParams } = {
  params: new URLSearchParams(),
};

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
  urlQuery?: string;
  data?: TestRow[];
  emptyMessage?: ReactNode;
}) {
  searchParamsHolder.params = new URLSearchParams(options.urlQuery ?? "");
  return renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={options.data ?? rows}
      pageCount={1}
      total={options.data?.length ?? rows.length}
      {...(options.searchable === undefined ? {} : { searchable: options.searchable })}
      {...(options.filters ? { filters: options.filters } : {})}
      {...(options.emptyMessage ? { emptyMessage: options.emptyMessage } : {})}
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

  test("#133 pin: with searchable={false}, a URL q no control produced must not yield 'No results for'", () => {
    const html = renderTable({
      searchable: false,
      urlQuery: "q=foo",
      data: [],
      emptyMessage: "empty-message-marker",
    });

    expect(html.includes('No results for "foo".')).toBeFalse();
    expect(html.includes("empty-message-marker")).toBeTrue();
  });
});

describe("DataTable emptyMessage", () => {
  test("an element renders as the empty-state content, not only a string", () => {
    const html = renderTable({
      searchable: false,
      data: [],
      emptyMessage: (
        <span>
          Nothing here <a href="/reset">Reset</a>
        </span>
      ),
    });

    expect(html.includes('<a href="/reset">Reset</a>')).toBeTrue();
  });
});
