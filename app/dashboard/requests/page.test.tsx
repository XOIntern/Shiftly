import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
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
import type { SessionUser } from "@/types/session";

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
  useRouter: () => ({}),
  usePathname: () => "/dashboard/requests",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/cache", () => ({
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
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const html = await renderRequests();
      expect(html.includes("Requests")).toBeTrue();
      expect(html.includes(fx.anchors.rqA1)).toBeTrue();
      expect(html.includes(fx.anchors.rqA2)).toBeTrue();
      expect(html.includes(fx.anchors.rqB1)).toBeFalse();
      expect(html.includes("New request")).toBeFalse();
    } finally {
      await fx.cleanup();
    }
  });

  test("admin sees only their own location's rows plus the create button", async () => {
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locA1);

      const html = await renderRequests();
      expect(html.includes(fx.anchors.rqA1)).toBeTrue();
      expect(html.includes(fx.anchors.rqA2)).toBeFalse();
      expect(html.includes(fx.anchors.rqB1)).toBeFalse();
      expect(html.includes("New request")).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("superadmin sees every site's requests and the create entry points", async () => {
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      const html = await renderRequests();
      expect(html.includes(fx.anchors.rqA1)).toBeTrue();
      expect(html.includes(fx.anchors.rqA2)).toBeTrue();
      expect(html.includes(fx.anchors.rqB1)).toBeTrue();
      // The header button links to the full-page create form (#130).
      expect(html.includes('href="/dashboard/requests/new"')).toBeTrue();
      expect(html.includes("New request")).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("an unbound admin's empty scope shows the empty state", async () => {
    actor = makeActor("admin", null, null);

    const html = await renderRequests();
    expect(html.includes("No requests yet")).toBeTrue();
  });

  test("the status URL filter narrows to matching statuses", async () => {
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const html = await renderRequests({ status: "approved" });
      expect(html.includes(fx.anchors.rqA1)).toBeFalse();
      expect(html.includes(fx.anchors.rqA2)).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("?status=withdrawn shows only withdrawn rows and their badge reads Withdrawn", async () => {
    const fx = await seedRequestFixtures();
    const withdrawnId = randomUUID();
    const withdrawnMonday = "2026-02-02"; // a Monday no seeded row uses
    try {
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
    } finally {
      await db.delete(mpRequest).where(eq(mpRequest.id, withdrawnId));
      await fx.cleanup();
    }
  });

  test("the type URL filter narrows to matching types", async () => {
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const html = await renderRequests({ type: "daily" });
      expect(html.includes(fx.anchors.rqA1)).toBeFalse();
      expect(html.includes(fx.anchors.rqA2)).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("a ?q= deep link is ignored: rows still render (#133)", async () => {
    // The search lived on the (removed) notes column; with no searchable
    // column left the page must ignore the param entirely.
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const html = await renderRequests({ q: "zzz-no-such-row-zzz" });
      expect(html.includes(fx.anchors.rqA1)).toBeTrue();
      expect(html.includes(fx.anchors.rqA2)).toBeTrue();
      expect(html.includes(fx.anchors.rqB1)).toBeFalse();
    } finally {
      await fx.cleanup();
    }
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
  status: "open" as const,
  weekStart: "2026-11-02",
  requestDate: null,
  siteLocationId: "loc-1",
  siteName: "Site",
  locationName: "Loc",
  lines: [],
  updatedAt: "2026-10-27T00:00:00.000Z",
};

describe("requests list: approval, roster link and filter", () => {
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
    expect(fulfilled.includes("View in roster →")).toBeTrue();
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

  test("canApproveRequest offers approval only for open weekly requests to an approver", async () => {
    const { canApproveRequest } = await import("./status-actions");
    const openDaily = {
      ...baseRow,
      type: "daily" as const,
      weekStart: null,
      requestDate: "2026-11-03",
    };
    expect(canApproveRequest(baseRow, true)).toBeTrue();
    expect(canApproveRequest(baseRow, false)).toBeFalse();
    expect(canApproveRequest(openDaily, true)).toBeFalse();
    expect(
      canApproveRequest({ ...baseRow, status: "approved" }, true),
    ).toBeFalse();
  });

  test("canWithdrawRequest is true only for an open request when canWrite", async () => {
    const { canWithdrawRequest } = await import("./status-actions");
    expect(canWithdrawRequest(baseRow, true)).toBeTrue();
    expect(canWithdrawRequest(baseRow, false)).toBeFalse();
    for (const status of [
      "approved",
      "fulfilled",
      "rejected",
      "withdrawn",
    ] as const) {
      expect(canWithdrawRequest({ ...baseRow, status }, true)).toBeFalse();
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

  test("rejectDialogCopy asks for confirmation and warns the admin must re-enter the request", async () => {
    const { rejectDialogCopy } = await import("./status-actions");
    expect(rejectDialogCopy(baseRow)).toEqual({
      title: "Reject this request?",
      body: "This cannot be undone. The admin will need to enter a new request.",
    });
  });

  test("ho sees Approve and Reject on an open weekly row and none on an approved row", async () => {
    const fx = await seedRequestFixtures();
    const dailyId = randomUUID();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);
      // An OPEN daily request: the only thing keeping it from Approve and
      // Reject is its type.
      await db.insert(mpRequest).values({
        id: dailyId,
        siteId: fx.ids.siteA,
        siteLocationId: fx.ids.locA2,
        type: "daily",
        status: "open",
        requestDate: "2026-01-08",
        createdBy: fx.creator,
      });

      const open = await renderRequests();
      expect(
        open.includes('aria-label="Approve request for week of 2026-01-05"'),
      ).toBeTrue();
      expect(
        open.includes('aria-label="Reject request for week of 2026-01-05"'),
      ).toBeTrue();
      // The open daily row renders, yet offers no approval buttons.
      expect(open.includes("2026-01-08")).toBeTrue();
      expect(open.includes("Approve request for date")).toBeFalse();
      expect(open.includes("Reject request for date")).toBeFalse();

      await db.delete(mpRequest).where(eq(mpRequest.id, dailyId));
      await db
        .update(mpRequest)
        .set({ status: "approved" })
        .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
      const approved = await renderRequests();
      expect(approved.includes("Approve request for")).toBeFalse();
      expect(approved.includes("Reject request for")).toBeFalse();
    } finally {
      await db.delete(mpRequest).where(eq(mpRequest.id, dailyId));
      await fx.cleanup();
    }
  });

  test("superadmin sees Approve and Reject on open weekly rows", async () => {
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      const html = await renderRequests();
      expect(html.includes("Approve request for week of 2026-01-05")).toBeTrue();
      expect(html.includes("Reject request for week of 2026-01-12")).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("admin sees Edit on an open row and no Approve/Reject", async () => {
    const { canEditRequest } = await import("./status-actions");
    expect(canEditRequest(baseRow, true)).toBeTrue();
    expect(canEditRequest({ ...baseRow, status: "approved" }, true)).toBeFalse();
    expect(canEditRequest({ ...baseRow, status: "fulfilled" }, true)).toBeFalse();
    expect(canEditRequest({ ...baseRow, status: "rejected" }, true)).toBeFalse();
    expect(canEditRequest(baseRow, false)).toBeFalse();

    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locA1);

      const html = await renderRequests();
      expect(html.includes(fx.anchors.rqA1)).toBeTrue();
      expect(html.includes("Approve request for")).toBeFalse();
      expect(html.includes("Reject request for")).toBeFalse();
      expect(html.includes("awaiting approval")).toBeFalse();
    } finally {
      await fx.cleanup();
    }
  });

  test("ho page shows \"N requests awaiting approval\" linking to ?status=open when N > 0 and nothing when 0", async () => {
    const fx = await seedRequestFixtures();
    const extra = randomUUID();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      // siteA holds one open weekly request (rqB1 is another site's).
      const one = await renderRequests();
      expect(one.includes("1 request awaiting approval")).toBeTrue();
      expect(
        one.includes('href="/dashboard/requests?status=open&amp;type=weekly"'),
      ).toBeTrue();

      await db.insert(mpRequest).values({
        id: extra,
        siteId: fx.ids.siteA,
        siteLocationId: fx.ids.locA2,
        type: "weekly",
        status: "open",
        weekStart: "2026-01-19",
        createdBy: fx.creator,
      });
      const two = await renderRequests();
      expect(two.includes("2 requests awaiting approval")).toBeTrue();

      await db.delete(mpRequest).where(eq(mpRequest.id, extra));
      await db
        .update(mpRequest)
        .set({ status: "approved" })
        .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
      const none = await renderRequests();
      expect(none.includes("awaiting approval")).toBeFalse();
    } finally {
      await db.delete(mpRequest).where(eq(mpRequest.id, extra));
      await fx.cleanup();
    }
  });

  test("the Roster column renders \"View in roster →\" with the right href", async () => {
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const before = await renderRequests();
      expect(before.includes("View in roster")).toBeFalse();

      await db
        .update(mpRequest)
        .set({ status: "fulfilled" })
        .where(eq(mpRequest.siteLocationId, fx.ids.locA1));
      const after = await renderRequests();
      expect(after.includes("View in roster →")).toBeTrue();
      expect(
        after.includes(
          `href="/dashboard/roster?week=2026-01-05&amp;locationId=${fx.ids.locA1}"`,
        ),
      ).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });
});
