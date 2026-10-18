import { and, asc, count, eq, ilike, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { department, site, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { buildOrder } from "@/lib/table-order";
import {
  PAGE_SIZE_OPTIONS,
  ilikePattern,
  parseTableSearchParams,
} from "@/lib/table-params";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import {
  CreateDepartmentButton,
  type SiteOption,
} from "@/components/departments/department-form";
import { DepartmentsTable } from "@/components/departments/departments-table";

// Deliberate block: the page queries master data behind the session check,
// so there is no static shell worth shipping first. See:
// https://nextjs.org/docs/messages/blocking-prerender-dynamic
export const instant = false;

// Whitelist + default order per the epic's URL contract — sort column ids
// the URL may name, never composed from user input.
const SORTABLE = {
  name: department.name,
  siteName: site.name,
  isActive: department.isActive,
};
const DEFAULT_ORDER = [asc(site.name), asc(department.name)];

// The reference algorithm (see the Sites pilot, epic #24): validate URL
// state, count first for pageCount, clamp the page, then fetch one page.
export default async function DepartmentsPage({
  searchParams,
}: PageProps<"/dashboard/departments">) {
  // requireUser, not requireHO: admins get view-only access here.
  const actor = await requireUser();
  const { q, status, siteId, page, sorts, pageSize } = parseTableSearchParams(
    await searchParams,
    PAGE_SIZE_OPTIONS,
  );
  const isSuperadmin = actor.role === "superadmin";
  const isHo = actor.role === "ho";

  // A ho sees their own site's departments. An admin manages no network
  // here but still views the departments of the site their site_location
  // belongs to — the site is derived from their binding, and a missing
  // binding sees nothing rather than everything (sql`false`).
  // A ho without a binding (invariant breach) behaves the same way.
  let scopedSiteId: string | null = null;
  if (!isSuperadmin) {
    if (isHo) {
      scopedSiteId = actor.siteId;
    } else if (actor.siteLocationId) {
      const [locationRow] = await db
        .select({ siteId: siteLocation.siteId })
        .from(siteLocation)
        .where(
          and(
            eq(siteLocation.id, actor.siteLocationId),
            isNull(siteLocation.deletedAt),
          ),
        )
        .limit(1);
      scopedSiteId = locationRow?.siteId ?? null;
    }
  }

  const scope: SQL | undefined = isSuperadmin
    ? undefined
    : scopedSiteId
      ? eq(department.siteId, scopedSiteId)
      : sql`false`;

  // Site filter is a superadmin tool: a ho (or an admin, by derivation) is
  // already scoped at the data level, so the URL param is never consulted
  // for them.
  const siteFilter: SQL | undefined =
    isSuperadmin && siteId ? eq(department.siteId, siteId) : undefined;

  const pattern = ilikePattern(q);
  // Name-only search; the joined site name is deliberately not searched
  // (locked decision 3). Null-safe and(...) composes scope+search+filters.
  const where = and(
    ...(pattern ? [ilike(department.name, pattern)] : []),
    ...(status ? [eq(department.isActive, status === "active")] : []),
    ...(siteFilter ? [siteFilter] : []),
    ...(scope ? [scope] : []),
  );

  // Own-property lookup inside buildOrder: a plain truthiness guard would
  // admit prototype-chain `columnIds` (e.g. `?sort=__proto__`), which
  // drizzle rejects mid-render.
  const order = buildOrder(sorts, SORTABLE, DEFAULT_ORDER);

  const [{ count: rowCount }] = await db
    .select({ count: count() })
    .from(department)
    .innerJoin(site, eq(department.siteId, site.id))
    .where(and(where, isNull(department.deletedAt)));
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));
  const clamped = Math.min(page, pageCount); // out-of-range clamps to last page

  const [sites, departments] = await Promise.all([
    db
      .select({ id: site.id, name: site.name })
      .from(site)
      .where(
        and(
          ...(isSuperadmin
            ? []
            : scopedSiteId
              ? [eq(site.id, scopedSiteId)]
              : [sql`false`]),
          isNull(site.deletedAt),
        ),
      )
      .orderBy(asc(site.name)),
    db
      .select({
        id: department.id,
        name: department.name,
        isActive: department.isActive,
        siteId: department.siteId,
        siteName: site.name,
      })
      .from(department)
      .innerJoin(site, eq(department.siteId, site.id))
      .where(and(where, isNull(department.deletedAt)))
      .orderBy(...order)
      .limit(pageSize)
      .offset((clamped - 1) * pageSize),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
          <p className="text-sm text-muted-foreground">
            HR groupings scoped to each site. Site admins get view-only access
            here; the ho manages their own site&apos;s departments.
          </p>
        </div>
        {isHo || isSuperadmin ? (
          <CreateDepartmentButton
            sites={sites satisfies SiteOption[]}
            showSiteSelect={isSuperadmin}
          />
        ) : null}
      </div>
      <Card>
        <CardContent>
          <DepartmentsTable
            departments={departments}
            sites={sites satisfies SiteOption[]}
            canManage={actor.role !== "admin"}
            showSiteFilter={isSuperadmin}
            pageCount={pageCount}
            total={rowCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
