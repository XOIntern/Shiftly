"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createColumnHelper } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table";
import { dataTableFeatures } from "@/components/data-table-features";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RequestStatusBadge,
  rosterHrefFor,
} from "@/app/dashboard/requests/request-status";
import { MpRequestRowActions } from "@/app/dashboard/requests/status-actions";
import type { MpRequestRow } from "@/types/mp-request";

// The badge and roster link moved to request-status so the detail dialog in
// status-actions can use them without importing this module (a cycle).
export { RequestStatusBadge, rosterHrefFor };

const helper = createColumnHelper<typeof dataTableFeatures, MpRequestRow>();

// The anchor column: weekly requests show their ISO Monday, daily requests
// the single date (spec §3.3).
export const requestAnchor = (request: MpRequestRow): string =>
  request.type === "weekly" ? (request.weekStart ?? "") : (request.requestDate ?? "");

export const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "approved", label: "Approved" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

// Toolbar filter for the request-status column — the same URL contract as
// the shared isActive StatusFilter, but over the request-status enum
// (?status=open|approved|fulfilled|rejected|withdrawn).
export function RequestStatusFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const raw = searchParams.get("status");
  const allowed = (candidate: string | null): candidate is MpRequestRow["status"] =>
    candidate === "open" ||
    candidate === "approved" ||
    candidate === "fulfilled" ||
    candidate === "rejected" ||
    candidate === "withdrawn";
  const value = allowed(raw) ? raw : "all";

  const change = (next: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (allowed(next)) {
      params.set("status", next);
    } else {
      params.delete("status");
    }
    params.set("page", "1");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select items={STATUS_OPTIONS} value={value} onValueChange={change}>
      <SelectTrigger
        aria-label="Filter by request status"
        className="w-40"
        disabled={pending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// Toolbar filter for the weekly/daily split (?type=weekly|daily).
export function RequestTypeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const raw = searchParams.get("type");
  const value = raw === "weekly" || raw === "daily" ? raw : "all";

  const change = (next: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "weekly" || next === "daily") {
      params.set("type", next);
    } else {
      params.delete("type");
    }
    params.set("page", "1");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <Select
      items={[
        { value: "all", label: "All types" },
        { value: "weekly", label: "Weekly" },
        { value: "daily", label: "Daily" },
      ]}
      value={value}
      onValueChange={change}
    >
      <SelectTrigger
        aria-label="Filter by request type"
        className="w-32"
        disabled={pending}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="daily">Daily</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// Deterministic stamp for the server-rendered updatedAt Date (ISO string
// once serialized) — UTC, so markup matches across timezones.
const formatStamp = (iso: string) =>
  new Date(iso).toISOString().slice(0, 16).replace("T", " ");

export function RequestsTable({
  requests,
  canWrite,
  canApprove,
  showSite,
  showLocation,
  pageCount,
  total,
  filtered,
}: {
  requests: MpRequestRow[];
  // May the actor write lines (admin + superadmin)? Only the row actions'
  // edit entry switches on this.
  canWrite: boolean;
  // May the actor approve or reject open weekly requests (ho + superadmin)?
  canApprove: boolean;
  // Site/location columns only carry information where the actor's scope
  // spans more than one of them: location for ho/superadmin, site for
  // superadmin alone.
  showSite: boolean;
  showLocation: boolean;
  pageCount: number;
  total: number;
  // A status or type filter is active, so an empty page means "nothing
  // matches" rather than "nothing exists".
  filtered: boolean;
}) {
  // useTable requires stable columns.
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("type", {
          header: "Type",
          meta: { thClassName: "w-24", sortable: true },
          cell: (info) => (info.getValue() === "weekly" ? "Weekly" : "Daily"),
        }),
        helper.accessor("status", {
          header: "Status",
          meta: { thClassName: "min-w-[110px]", sortable: true },
          cell: (info) => <RequestStatusBadge status={info.getValue()} />,
        }),
        helper.accessor((row) => row.weekStart ?? row.requestDate, {
          id: "anchor",
          header: "Week / date",
          meta: { thClassName: "min-w-[120px]", tdClassName: "tabular-nums" },
          cell: (info) => (
            <span className="block tabular-nums">
              {requestAnchor(info.row.original)}
            </span>
          ),
        }),
        helper.accessor((row) => row.lines.length, {
          id: "lines",
          header: "Lines",
          meta: { thClassName: "w-16", tdClassName: "tabular-nums" },
        }),
        ...(showLocation
          ? [
              helper.accessor("locationName", {
                header: "Location",
                meta: { thClassName: "min-w-[160px]" },
              }),
            ]
          : []),
        ...(showSite
          ? [
              helper.accessor("siteName", {
                header: "Site",
                meta: { thClassName: "min-w-[160px]" },
              }),
            ]
          : []),
        helper.accessor("updatedAt", {
          id: "createdAt", // sort whitelist id (lib buildOrder contract)
          header: "Updated",
          meta: { thClassName: "min-w-[140px]", sortable: true },
          cell: (info) => (
            <span className="tabular-nums">{formatStamp(info.getValue())}</span>
          ),
        }),
        helper.display({
          id: "roster",
          header: "Roster",
          meta: { thClassName: "min-w-[140px]" },
          cell: (info) => {
            const href = rosterHrefFor(info.row.original);
            return href ? (
              <Link
                href={href}
                className="text-sm font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                View in roster <span aria-hidden="true">→</span>
              </Link>
            ) : (
              <span className="text-muted-foreground">
                -<span className="sr-only">No roster yet</span>
              </span>
            );
          },
        }),
        helper.display({
          id: "actions",
          header: "Actions",
          meta: {
            thClassName: "min-w-[100px] text-right",
            tdClassName: "text-right",
          },
          cell: (info) => (
            <MpRequestRowActions
              request={info.row.original}
              canWrite={canWrite}
              canApprove={canApprove}
            />
          ),
        }),
      ]),
    [canWrite, canApprove, showSite, showLocation],
  );

  return (
    <DataTable
      columns={columns}
      data={requests}
      pageCount={pageCount}
      total={total}
      emptyMessage={
        filtered ? (
          <span>
            No requests match these filters.{" "}
            <Link
              href="/dashboard/requests"
              className="font-medium text-foreground underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Clear filters
            </Link>
          </span>
        ) : (
          "No requests yet"
        )
      }
      // The `q` search lived on the (dropped) notes column — nothing left
      // to match, so the requests table opts out of the toolbar search #133.
      searchable={false}
      getRowId={(row) => row.id}
      filters={
        <>
          <RequestStatusFilter />
          <RequestTypeFilter />
        </>
      }
    />
  );
}
