import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { CalendarPlusIcon } from "lucide-react";

import {
  mpRequest,
  mpRequestLine,
  site,
  siteLocation,
  workArea,
  shiftDefinition,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireUser } from "@/lib/session";
import { mpRequestListWhere } from "@/lib/mp-request-scope";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  MpRequestLineView,
  MpRequestRow,
} from "@/types/mp-request";
import { RequestsTable } from "@/app/dashboard/requests/requests-table";

// Deliberate block: the page queries request data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = {
  weekStart: mpRequest.weekStart,
  requestDate: mpRequest.requestDate,
  status: mpRequest.status,
  type: mpRequest.type,
  createdAt: mpRequest.createdAt,
};
// The natural order sorts on the request's effective anchor (a weekly
// request's week start, a daily one's date), then createdAt as the
// tie-breaker: expressed as a raw SQL order expression because no pair of
// column keys can encode the coalesce.
const DEFAULT_ORDER = [
  desc(sql`coalesce(${mpRequest.requestDate}, ${mpRequest.weekStart})`),
  desc(mpRequest.createdAt),
];

// Single-string URL params with an enum whitelist (the mp_request status
// and type filters live outside parseTableSearchParams's isActive slot).
function whitelistParam<T extends string>(
  raw: Record<string, string | string[] | undefined>,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = raw[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single && (allowed as readonly string[]).includes(single)
    ? (single as T)
    : null;
}

export default async function RequestsPage({
  searchParams,
}: PageProps<"/dashboard/requests">) {
  // requireUser, not a stricter guard: all three roles view the page —
  // they differ by the scope of rows shown and the write surface (spec
  // §3.3: ho views + advances, admin/superadmin write lines).
  const actor = await requireUser();
  const raw = await searchParams;
  // `q` is deliberately not read #133: the search lived on the (dropped)
  // notes column, so a ?q= URL param is simply ignored rather than filtered.
  const { page, sorts, pageSize } = parseTableSearchParams(
    raw,
    PAGE_SIZE_OPTIONS,
  );
  const status = whitelistParam(raw, "status", [
    "submitted",
    "received",
    "processing",
    "fulfilled",
    "rejected",
  ] as const);
  const type = whitelistParam(raw, "type", ["weekly", "daily"] as const);
  const isSuperadmin = actor.role === "superadmin";
  // An ho views only: the create/edit writes never extend to them.
  const canWrite = actor.role !== "ho";

  // Scope comes straight from the shared scope module (superadmin
  // unbounded, ho by their site, admin by their site_location; a null
  // binding matches nothing rather than everything).
  const scope = mpRequestListWhere(actor);

  // Null-safe and(...) composes scope+filters. Notes search is gone (#133):
  // the status/type filters remain, nothing free-text narrows the rows.
  const where = and(
    ...(status ? [eq(mpRequest.status, status)] : []),
    ...(type ? [eq(mpRequest.type, type)] : []),
    ...(scope ? [scope] : []),
  );

  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(mpRequest)
    .innerJoin(site, eq(mpRequest.siteId, site.id))
    .innerJoin(siteLocation, eq(mpRequest.siteLocationId, siteLocation.id))
    .where(where);
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  // Page rows first; their lines load below. (The create/edit dialogs'
  // masters moved server-side to /dashboard/requests/new and
  // /dashboard/requests/[id]/edit — #130.)
  const requestRows = await db
    .select({
      id: mpRequest.id,
      type: mpRequest.type,
      status: mpRequest.status,
      weekStart: mpRequest.weekStart,
      requestDate: mpRequest.requestDate,
      siteLocationId: mpRequest.siteLocationId,
      siteName: site.name,
      locationName: siteLocation.name,
      updatedAt: mpRequest.updatedAt,
    })
    .from(mpRequest)
    .innerJoin(site, eq(mpRequest.siteId, site.id))
    .innerJoin(siteLocation, eq(mpRequest.siteLocationId, siteLocation.id))
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset((clamped - 1) * pageSize);

  const requestIds = requestRows.map((row) => row.id);
  const lineRows = requestIds.length
    ? await db
        .select({
          requestId: mpRequestLine.requestId,
          workAreaId: mpRequestLine.workAreaId,
          workAreaName: workArea.name,
          shiftDefinitionId: mpRequestLine.shiftDefinitionId,
          shiftLabel: shiftDefinition.label,
          date: mpRequestLine.date,
          headcount: mpRequestLine.headcount,
        })
        .from(mpRequestLine)
        .innerJoin(workArea, eq(mpRequestLine.workAreaId, workArea.id))
        .innerJoin(
          shiftDefinition,
          eq(mpRequestLine.shiftDefinitionId, shiftDefinition.id),
        )
        .where(inArray(mpRequestLine.requestId, requestIds))
    : [];
  const linesByRequest = new Map<string, MpRequestLineView[]>();
  for (const line of lineRows) {
    const list = linesByRequest.get(line.requestId) ?? [];
    list.push(line);
    linesByRequest.set(line.requestId, list);
  }

  const requests: MpRequestRow[] = requestRows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    lines: linesByRequest.get(row.id) ?? [],
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground">
            Weekly and daily manpower requests per location, moving through
            submitted → received → processing → fulfilled/rejected.
          </p>
        </div>
        {canWrite ? (
          <Button
            nativeButton={false}
            render={<Link href="/dashboard/requests/new" />}
          >
            <CalendarPlusIcon data-icon="inline-start" />
            New request
          </Button>
        ) : null}
      </div>
      <Card>
        <CardContent>
          <RequestsTable
            requests={requests}
            canWrite={canWrite}
            showSite={isSuperadmin}
            showLocation={actor.role !== "admin"}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
