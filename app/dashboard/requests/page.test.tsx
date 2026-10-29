import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  mpRequest,
  mpRequestLine,
  position,
  shiftDefinition,
  site,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import type { MpRequestRow } from "@/types/mp-request";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import { seedRosterPlan } from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The requests page reads its actor through requireUser (all three roles
// see the page; scope differs per role) — swapped for a stub so the real
// server component can render against the test database. The mock swaps
// the WHOLE module across bun's single test process, so every export other
// suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// The tree the page hands back renders client tables (DataTable, filters)
// that read navigation hooks; no Next request context exists under bun
// test, so next/navigation is stubbed. The form module's "use server"
// imports pull next/cache at module scope — stubbed the same way.
const realNavigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...realNavigation,
  redirect: () => {
    throw new Error("redirect");
  },
  // Pages under test may call notFound(); every stub in the repo carries it
  // because bun's module mocks are process-wide and the last registration
  // wins across suites.
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({}),
  usePathname: () => "/dashboard/requests",
  useSearchParams: () => new URLSearchParams(),
}));
// Real exports kept (revalidateTag, updateTag, … stay available to suites that
// run after this one: module mocks are process-wide); only revalidatePath is
// replaced, since there is no Next request context under bun test.
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

async function renderRequests(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  const { default: RequestsPage } = await import("./page");
  const tree = await RequestsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  return renderToStaticMarkup(tree);
}

// The rows the page hands to RequestsTable. The row menu (Edit lines,
// Withdraw) only mounts when opened, so the offered controls are read off the
// props the page computed rather than off the closed menu's markup.
async function pageRows(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<MpRequestRow[]> {
  const { default: RequestsPage } = await import("./page");
  const tree = await RequestsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const seen: unknown[] = [tree];
  while (seen.length) {
    const node = seen.pop();
    if (Array.isArray(node)) seen.push(...node);
    else if (isValidElement(node)) {
      const props = node.props as { requests?: MpRequestRow[]; children?: unknown };
      if (props.requests) return props.requests;
      seen.push(props.children);
    }
  }
  throw new Error("RequestsTable not found in the page tree");
}

// Shared fixture: site A holds locations LA1/LA2 and site B holds LB1. Each
// location carries one active work area + one active shift so their
// requests can hold lines. rqA1 (weekly, under LA1), rqA2 (daily, under
// LA2) and rqB1 (weekly, under LB1) are told apart by their anchors —
// three distinct dates no other rendered field carries. Child-first cleanup.
async function seedRequestFixtures() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locA2 = randomUUID();
  const locB1 = randomUUID();
  const waA1 = randomUUID();
  const waA2 = randomUUID();
  const waB1 = randomUUID();
  const posA1 = randomUUID();
  const posA2 = randomUUID();
  const posB1 = randomUUID();
  const shA1 = randomUUID();
  const shA2 = randomUUID();
  const shB1 = randomUUID();
  const rqA1 = randomUUID();
  const rqA2 = randomUUID();
  const rqB1 = randomUUID();
  const creator = `t-rq-creator-${randomUUID().slice(0, 8)}`;
  const suffix = randomUUID().slice(0, 8);
  // One Monday per weekly request: the anchor cell's date uniquely names
  // each row in the markup (notes no longer render — #133).
  const mondayA1 = "2026-01-05"; // a Monday
  const mondayB1 = "2026-01-12"; // the next Monday

  await db.insert(user).values({
    id: creator,
    name: creator,
    email: `${creator}@shiftly.test`,
    role: "superadmin",
  });
  await db.insert(site).values([
    { id: siteA, name: `t-rq-site-a-${siteA}` },
    { id: siteB, name: `t-rq-site-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t-rq-loc-a1-${locA1}` },
    { id: locA2, siteId: siteA, name: `t-rq-loc-a2-${locA2}` },
    { id: locB1, siteId: siteB, name: `t-rq-loc-a1-b-${locB1}` },
  ]);
  await db.insert(workArea).values([
    { id: waA1, siteLocationId: locA1, siteId: siteA, name: `t-rq-wa-a1-${suffix}` },
    { id: waA2, siteLocationId: locA2, siteId: siteA, name: `t-rq-wa-a2-${suffix}` },
    { id: waB1, siteLocationId: locB1, siteId: siteB, name: `t-rq-wa-b1-${suffix}` },
  ]);
  await db.insert(shiftDefinition).values([
    {
      id: shA1,
      siteLocationId: locA1,
      siteId: siteA,
      label: `t-rq-shift-a1-${suffix}`,
      orderIndex: 1,
      startTime: "06:00",
      endTime: "14:00",
    },
    {
      id: shA2,
      siteLocationId: locA2,
      siteId: siteA,
      label: `t-rq-shift-a2-${suffix}`,
      orderIndex: 1,
      startTime: "14:00",
      endTime: "22:00",
    },
    {
      id: shB1,
      siteLocationId: locB1,
      siteId: siteB,
      label: `t-rq-shift-b1-${suffix}`,
      orderIndex: 1,
      startTime: "08:00",
      endTime: "16:00",
    },
  ]);
  // Lines demand a required position of their work area (epic #135):
  // one pivoted position per area, name-riding on the page's join.
  await db.insert(position).values([
    { id: posA1, siteId: siteA, name: `t-rq-pos-a1-${suffix}` },
    { id: posA2, siteId: siteA, name: `t-rq-pos-a2-${suffix}` },
    { id: posB1, siteId: siteB, name: `t-rq-pos-b1-${suffix}` },
  ]);
  await db.insert(workAreaPosition).values([
    { workAreaId: waA1, positionId: posA1, siteId: siteA, siteLocationId: locA1 },
    { workAreaId: waA2, positionId: posA2, siteId: siteA, siteLocationId: locA2 },
    { workAreaId: waB1, positionId: posB1, siteId: siteB, siteLocationId: locB1 },
  ]);
  await db.insert(mpRequest).values([
    {
      id: rqA1,
      siteId: siteA,
      siteLocationId: locA1,
      type: "weekly",
      status: "open",
      weekStart: mondayA1,
      createdBy: creator,
    },
    {
      id: rqA2,
      siteId: siteA,
      siteLocationId: locA2,
      type: "daily",
      status: "approved",
      requestDate: "2026-01-07",
      createdBy: creator,
    },
    {
      id: rqB1,
      siteId: siteB,
      siteLocationId: locB1,
      type: "weekly",
      status: "open",
      weekStart: mondayB1,
      createdBy: creator,
    },
  ]);
  await db.insert(mpRequestLine).values([
    {
      requestId: rqA1,
      siteId: siteA,
      siteLocationId: locA1,
      workAreaId: waA1,
      shiftDefinitionId: shA1,
      positionId: posA1,
      date: "2026-01-05",
      headcount: 3,
    },
    {
      requestId: rqA1,
      siteId: siteA,
      siteLocationId: locA1,
      workAreaId: waA1,
      shiftDefinitionId: shA1,
      positionId: posA1,
      date: "2026-01-06",
      headcount: 2,
    },
    {
      requestId: rqA2,
      siteId: siteA,
      siteLocationId: locA2,
      workAreaId: waA2,
      shiftDefinitionId: shA2,
      positionId: posA2,
      date: "2026-01-07",
      headcount: 4,
    },
    {
      requestId: rqB1,
      siteId: siteB,
      siteLocationId: locB1,
      workAreaId: waB1,
      shiftDefinitionId: shB1,
      positionId: posB1,
      date: "2026-01-12",
      headcount: 5,
    },
  ]);

  return {
    ids: { siteA, siteB, locA1, locA2, locB1 },
    creator,
    // The anchor dates each row renders in the table — presence/exclusion
    // is asserted on these instead of note tokens (#133).
    anchors: { rqA1: "2026-01-05", rqA2: "2026-01-07", rqB1: "2026-01-12" },
    counts: { rqA1Lines: 2, rqA2Lines: 1, rqB1Lines: 5 },
    async cleanup() {
      for (const id of [rqA1, rqA2, rqB1]) {
        await db.delete(mpRequestLine).where(eq(mpRequestLine.requestId, id));
        await db.delete(mpRequest).where(eq(mpRequest.id, id));
      }
      for (const id of [posA1, posA2, posB1]) {
        // The pivot RESTRICTs both parents — drop it first.
        await db
          .delete(workAreaPosition)
          .where(eq(workAreaPosition.positionId, id));
      }
      for (const id of [waA1, waA2, waB1]) {
        await db.delete(workArea).where(eq(workArea.id, id));
      }
      for (const id of [posA1, posA2, posB1]) {
        await db.delete(position).where(eq(position.id, id));
      }
      for (const id of [shA1, shA2, shB1]) {
        await db.delete(shiftDefinition).where(eq(shiftDefinition.id, id));
      }
      for (const id of [locA1, locA2, locB1]) {
        await db.delete(siteLocation).where(eq(siteLocation.id, id));
      }
      for (const id of [siteA, siteB]) {
        await db.delete(site).where(eq(site.id, id));
      }
      await db.delete(user).where(eq(user.id, creator));
    },
  };
}

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T-RQ Actor",
    email: `t-rq-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// Spec §3.3: all three roles view /dashboard/requests within their scope;
// the create button is an admin+superadmin tool (ho only views).
describe("requests page SSR (mp-requests Task 8)", () => {
  test("renders the Requests heading and an ho's own-site rows without the create button", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const html = await renderRequests();
    expect(html.includes("Requests")).toBeTrue();
    // The title is where focus lands after a confirmed Reject removes the
    // row and its trigger.
    const title = html.match(/<h1[^>]*>Requests<\/h1>/)?.[0] ?? "";
    expect(title).toContain(" data-focus-fallback=");
    expect(title).toContain('tabindex="-1"');
    expect(html.includes(fx.anchors.rqA1)).toBeTrue();
    expect(html.includes(fx.anchors.rqA2)).toBeTrue();
    expect(html.includes(fx.anchors.rqB1)).toBeFalse();
    expect(html.includes("New request")).toBeFalse();
  });

  test("admin sees only their own location's rows plus the create button", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("admin", null, fx.ids.locA1);

    const html = await renderRequests();
    expect(html.includes(fx.anchors.rqA1)).toBeTrue();
    expect(html.includes(fx.anchors.rqA2)).toBeFalse();
    expect(html.includes(fx.anchors.rqB1)).toBeFalse();
    expect(html.includes("New request")).toBeTrue();
  });

  test("superadmin sees every site's requests and the create entry points", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const html = await renderRequests();
    expect(html.includes(fx.anchors.rqA1)).toBeTrue();
    expect(html.includes(fx.anchors.rqA2)).toBeTrue();
    expect(html.includes(fx.anchors.rqB1)).toBeTrue();
    // The header button links to the full-page create form (#130).
    expect(html.includes('href="/dashboard/requests/new"')).toBeTrue();
    expect(html.includes("New request")).toBeTrue();
  });

  test("an unbound admin's empty scope shows the empty state", async () => {
    actor = makeActor("admin", null, null);

    const html = await renderRequests();
    expect(html.includes("No requests yet")).toBeTrue();
  });

  test("the status URL filter narrows to matching statuses", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const html = await renderRequests({ status: "approved" });
    expect(html.includes(fx.anchors.rqA1)).toBeFalse();
    expect(html.includes(fx.anchors.rqA2)).toBeTrue();
  });

  test("?status=withdrawn shows only withdrawn rows and their badge reads Withdrawn", async () => {
    const fx = await seedRequestFixtures();
    const withdrawnId = randomUUID();
    const withdrawnMonday = "2026-02-02"; // a Monday no seeded row uses
    fixtureCleanup.defer(async () => {
      await db.delete(mpRequest).where(eq(mpRequest.id, withdrawnId));
      await fx.cleanup();
    });
    await db.insert(mpRequest).values({
      id: withdrawnId,
      siteId: fx.ids.siteA,
      siteLocationId: fx.ids.locA1,
      type: "weekly",
      status: "withdrawn",
      weekStart: withdrawnMonday,
      createdBy: fx.creator,
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const html = await renderRequests({ status: "withdrawn" });
    expect(html.includes(withdrawnMonday)).toBeTrue();
    expect(html.includes(fx.anchors.rqA1)).toBeFalse();
    expect(html.includes(fx.anchors.rqA2)).toBeFalse();

    const { RequestStatusBadge } = await import("./request-status");
    expect(
      renderToStaticMarkup(<RequestStatusBadge status="withdrawn" />).includes(
        "Withdrawn",
      ),
    ).toBeTrue();
  });

  test("the type URL filter narrows to matching types", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const html = await renderRequests({ type: "daily" });
    expect(html.includes(fx.anchors.rqA1)).toBeFalse();
    expect(html.includes(fx.anchors.rqA2)).toBeTrue();
  });

  test("a ?q= deep link is ignored: rows still render (#133)", async () => {
    // The search lived on the (removed) notes column; with no searchable
    // column left the page must ignore the param entirely.
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const html = await renderRequests({ q: "zzz-no-such-row-zzz" });
    expect(html.includes(fx.anchors.rqA1)).toBeTrue();
    expect(html.includes(fx.anchors.rqA2)).toBeTrue();
    expect(html.includes(fx.anchors.rqB1)).toBeFalse();
  });

  test("the line payload renders the position in the detail table", async () => {
    // The row-actions dialog mounts closed, so the page's SSR never shows
    // line names — the extracted lines table is the stateless surface the
    // dialog composes, pinned here directly (epic #135).
    const { RequestLinesTable } = await import("./status-actions");
    const html = renderToStaticMarkup(
      <RequestLinesTable
        lines={[
          {
            workAreaId: "wa-1",
            workAreaName: "PROBE_AREA",
            shiftDefinitionId: "sh-1",
            shiftLabel: "PROBE_SHIFT",
            positionId: "pos-1",
            positionName: "PROBE_POSITION",
            date: "2026-01-07",
            headcount: 3,
          },
        ]}
      />,
    );
    expect(html.includes("PROBE_AREA")).toBeTrue();
    expect(html.includes("PROBE_SHIFT")).toBeTrue();
    expect(html.includes("PROBE_POSITION")).toBeTrue();
    expect(html.includes("Position")).toBeTrue();
  });
});

const baseRow = {
  id: "rq-1",
  type: "weekly" as const,
  status: "approved" as const,
  weekStart: "2026-11-02",
  requestDate: null,
  siteLocationId: "loc-1",
  siteName: "Site",
  locationName: "Loc",
  lines: [],
  updatedAt: "2026-10-27T00:00:00.000Z",
  rosterLocked: false,
};

describe("requests list: roster link, filter and controls by roster state", () => {
  test("rosterHrefFor returns the roster link for approved and fulfilled weekly requests and null for open, rejected, withdrawn and daily", async () => {
    const { rosterHrefFor } = await import("./requests-table");
    const expected = "/dashboard/roster?week=2026-11-02&locationId=loc-1";
    expect(rosterHrefFor({ ...baseRow, status: "approved" })).toBe(expected);
    expect(rosterHrefFor({ ...baseRow, status: "fulfilled" })).toBe(expected);
    expect(rosterHrefFor({ ...baseRow, status: "open" })).toBeNull();
    expect(rosterHrefFor({ ...baseRow, status: "rejected" })).toBeNull();
    expect(rosterHrefFor({ ...baseRow, status: "withdrawn" })).toBeNull();
    expect(
      rosterHrefFor({
        ...baseRow,
        type: "daily",
        status: "approved",
        weekStart: null,
        requestDate: "2026-11-03",
      }),
    ).toBeNull();
  });

  test("the detail dialog of a fulfilled weekly request shows the Fulfilled badge and the roster link; an open request shows its badge and no link", async () => {
    const { RequestDetailStatus } = await import("./status-actions");

    const fulfilled = renderToStaticMarkup(
      <RequestDetailStatus request={{ ...baseRow, status: "fulfilled" }} />,
    );
    expect(fulfilled.includes("Fulfilled")).toBeTrue();
    expect(fulfilled.includes('View in roster <span aria-hidden="true">→</span>')).toBeTrue();
    expect(
      fulfilled.includes(
        'href="/dashboard/roster?week=2026-11-02&amp;locationId=loc-1"',
      ),
    ).toBeTrue();

    const open = renderToStaticMarkup(
      <RequestDetailStatus request={{ ...baseRow, status: "open" }} />,
    );
    expect(open.includes("Open")).toBeTrue();
    expect(open.includes("View in roster")).toBeFalse();
  });

  test("the status filter lists exactly Open, Approved, Fulfilled, Rejected, Withdrawn", async () => {
    const { STATUS_OPTIONS } = await import("./requests-table");
    expect(STATUS_OPTIONS.map((option) => option.label)).toEqual([
      "All statuses",
      "Open",
      "Approved",
      "Fulfilled",
      "Rejected",
      "Withdrawn",
    ]);
    expect(
      STATUS_OPTIONS.filter((o) => o.value !== "all").map((o) => o.value),
    ).toEqual(["open", "approved", "fulfilled", "rejected", "withdrawn"]);
  });

  test("canEditRequest and canWithdrawRequest follow the roster state and canWrite", async () => {
    const { canEditRequest, canWithdrawRequest } = await import(
      "./status-actions"
    );
    const dailyOpen = {
      ...baseRow,
      type: "daily" as const,
      status: "open" as const,
      weekStart: null,
      requestDate: "2026-11-03",
    };
    for (const can of [canEditRequest, canWithdrawRequest]) {
      expect(can(baseRow, true)).toBeTrue();
      expect(can(baseRow, false)).toBeFalse();
      expect(can({ ...baseRow, rosterLocked: true }, true)).toBeFalse();
      expect(can(dailyOpen, true)).toBeTrue();
      for (const status of ["open", "fulfilled", "rejected", "withdrawn"] as const) {
        expect(can({ ...baseRow, status }, true)).toBeFalse();
      }
    }
  });

  test("withdrawDialogCopy gives the weekly body for a weekly request and adds the fills sentence for a daily one", async () => {
    const { withdrawDialogCopy } = await import("./status-actions");
    const weeklyBody =
      "It stays in the list as Withdrawn and cannot be restored. You can create a new request for the same period afterwards.";

    expect(withdrawDialogCopy(baseRow)).toEqual({
      title: "Withdraw this request?",
      body: weeklyBody,
    });
    expect(
      withdrawDialogCopy({
        ...baseRow,
        type: "daily",
        weekStart: null,
        requestDate: "2026-11-03",
      }),
    ).toEqual({
      title: "Withdraw this request?",
      body: `${weeklyBody} Fills already made stay in the roster.`,
    });
  });

  test("the page subtitle states weekly requests are approved on entry", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const html = await renderRequests();
    expect(html).toContain(
      "Weekly requests are approved on entry and become fulfilled when the week&#x27;s roster is published. Daily requests stay open until their slot is filled.",
    );
  });

  test("no role sees Approve, Reject or an awaiting-approval banner", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    for (const next of [
      makeActor("ho", fx.ids.siteA, null),
      makeActor("admin", null, fx.ids.locA1),
      makeActor("superadmin", null, null),
    ]) {
      actor = next;
      const html = await renderRequests();
      expect(html.includes("Approve request ")).toBeFalse();
      expect(html.includes("Reject request ")).toBeFalse();
      expect(html.includes(">Approve<")).toBeFalse();
      expect(html.includes(">Reject<")).toBeFalse();
      expect(html.includes("awaiting approval")).toBeFalse();
    }
  });

  test("an admin is offered Edit and Withdraw on an approved weekly row until its week has a roster plan", async () => {
    const { canEditRequest, canWithdrawRequest } = await import(
      "./status-actions"
    );
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await db
      .update(mpRequest)
      .set({ status: "approved" })
      .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
    actor = makeActor("admin", null, fx.ids.locA1);

    const [free] = await pageRows();
    expect(free.rosterLocked).toBeFalse();
    expect(canEditRequest(free, true)).toBeTrue();
    expect(canWithdrawRequest(free, true)).toBeTrue();

    await seedRosterPlan(
      fixtureCleanup,
      { id: fx.ids.locA1, siteId: fx.ids.siteA },
      { weekStart: fx.anchors.rqA1, status: "draft" },
    );
    const [locked] = await pageRows();
    expect(locked.rosterLocked).toBeTrue();
    expect(canEditRequest(locked, true)).toBeFalse();
    expect(canWithdrawRequest(locked, true)).toBeFalse();
  });

  test("a plan for another location's same week does not lock the row", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await db
      .update(mpRequest)
      .set({ status: "approved" })
      .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
    await seedRosterPlan(
      fixtureCleanup,
      { id: fx.ids.locA2, siteId: fx.ids.siteA },
      { weekStart: fx.anchors.rqA1, status: "published" },
    );
    actor = makeActor("admin", null, fx.ids.locA1);

    const [row] = await pageRows();
    expect(row.rosterLocked).toBeFalse();
  });

  test("an ho sees the row but no write controls", async () => {
    const { canEditRequest, canWithdrawRequest } = await import(
      "./status-actions"
    );
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await db
      .update(mpRequest)
      .set({ status: "approved" })
      .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
    actor = makeActor("ho", fx.ids.siteA, null);

    const html = await renderRequests();
    expect(html.includes(fx.anchors.rqA1)).toBeTrue();
    expect(html.includes("New request")).toBeFalse();
    const rows = await pageRows();
    const weekly = rows.find((r) => r.weekStart === fx.anchors.rqA1)!;
    expect(canEditRequest(weekly, false)).toBeFalse();
    expect(canWithdrawRequest(weekly, false)).toBeFalse();
  });

  test("a superadmin is offered Edit and Withdraw on an unrostered approved weekly row", async () => {
    const { canEditRequest, canWithdrawRequest } = await import(
      "./status-actions"
    );
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await db
      .update(mpRequest)
      .set({ status: "approved" })
      .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
    actor = makeActor("superadmin", null, null);

    // Narrowed and widened so leftover rows in a shared database cannot push
    // the seeded one off the first page.
    const rows = await pageRows({
      status: "approved",
      type: "weekly",
      pageSize: "50",
    });
    const weekly = rows.find((r) => r.weekStart === fx.anchors.rqA1)!;
    expect(weekly.rosterLocked).toBeFalse();
    expect(canEditRequest(weekly, true)).toBeTrue();
    expect(canWithdrawRequest(weekly, true)).toBeTrue();
  });

  test("rejected and withdrawn weekly rows still list with their badges and filter", async () => {
    const fx = await seedRequestFixtures();
    const rejectedId = randomUUID();
    const withdrawnId = randomUUID();
    const rejectedMonday = "2026-02-09";
    const withdrawnMonday = "2026-02-16";
    fixtureCleanup.defer(async () => {
      await db
        .delete(mpRequest)
        .where(eq(mpRequest.id, rejectedId));
      await db
        .delete(mpRequest)
        .where(eq(mpRequest.id, withdrawnId));
      await fx.cleanup();
    });
    await db.insert(mpRequest).values([
      {
        id: rejectedId,
        siteId: fx.ids.siteA,
        siteLocationId: fx.ids.locA1,
        type: "weekly",
        status: "rejected",
        weekStart: rejectedMonday,
        createdBy: fx.creator,
      },
      {
        id: withdrawnId,
        siteId: fx.ids.siteA,
        siteLocationId: fx.ids.locA1,
        type: "weekly",
        status: "withdrawn",
        weekStart: withdrawnMonday,
        createdBy: fx.creator,
      },
    ]);
    actor = makeActor("ho", fx.ids.siteA, null);

    const all = await renderRequests();
    expect(all.includes(rejectedMonday)).toBeTrue();
    expect(all.includes(withdrawnMonday)).toBeTrue();
    expect(all.includes("Rejected")).toBeTrue();
    expect(all.includes("Withdrawn")).toBeTrue();

    const rejectedOnly = await renderRequests({ status: "rejected" });
    expect(rejectedOnly.includes(rejectedMonday)).toBeTrue();
    expect(rejectedOnly.includes(withdrawnMonday)).toBeFalse();
    expect(rejectedOnly.includes(fx.anchors.rqA1)).toBeFalse();
  });

  test("the Roster column renders \"View in roster\" with the right href", async () => {
    const fx = await seedRequestFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const before = await renderRequests();
    expect(before.includes("View in roster")).toBeFalse();

    await db
      .update(mpRequest)
      .set({ status: "fulfilled" })
      .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
    const after = await renderRequests();
    expect(after.includes('View in roster <span aria-hidden="true">→</span>')).toBeTrue();
    expect(
      after.includes(
        `href="/dashboard/roster?week=2026-01-05&amp;locationId=${fx.ids.locA1}"`,
      ),
    ).toBeTrue();
  });
});
