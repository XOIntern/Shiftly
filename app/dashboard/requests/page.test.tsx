import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  mpRequest,
  mpRequestLine,
  shiftDefinition,
  site,
  siteLocation,
  user,
  workArea,
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
// LA2) and rqB1 (weekly, under LB1) are told apart by unique note tokens —
// notes are never carried by another row. Child-first cleanup.
async function seedRequestFixtures() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locA2 = randomUUID();
  const locB1 = randomUUID();
  const waA1 = randomUUID();
  const waA2 = randomUUID();
  const waB1 = randomUUID();
  const shA1 = randomUUID();
  const shA2 = randomUUID();
  const shB1 = randomUUID();
  const rqA1 = randomUUID();
  const rqA2 = randomUUID();
  const rqB1 = randomUUID();
  const creator = `t-rq-creator-${randomUUID().slice(0, 8)}`;
  const suffix = randomUUID().slice(0, 8);
  const notes = {
    rqA1: `t-rq-alpha-${suffix}`,
    rqA2: `t-rq-other-loc-${suffix}`,
    rqB1: `t-rq-foreign-${suffix}`,
  };
  const monday = "2026-01-05"; // a Monday

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
  await db.insert(mpRequest).values([
    {
      id: rqA1,
      siteId: siteA,
      siteLocationId: locA1,
      type: "weekly",
      status: "submitted",
      weekStart: monday,
      notes: notes.rqA1,
      createdBy: creator,
    },
    {
      id: rqA2,
      siteId: siteA,
      siteLocationId: locA2,
      type: "daily",
      status: "received",
      requestDate: "2026-01-07",
      notes: notes.rqA2,
      createdBy: creator,
    },
    {
      id: rqB1,
      siteId: siteB,
      siteLocationId: locB1,
      type: "weekly",
      status: "submitted",
      weekStart: monday,
      notes: notes.rqB1,
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
      date: "2026-01-05",
      headcount: 3,
    },
    {
      requestId: rqA1,
      siteId: siteA,
      siteLocationId: locA1,
      workAreaId: waA1,
      shiftDefinitionId: shA1,
      date: "2026-01-06",
      headcount: 2,
    },
    {
      requestId: rqA2,
      siteId: siteA,
      siteLocationId: locA2,
      workAreaId: waA2,
      shiftDefinitionId: shA2,
      date: "2026-01-07",
      headcount: 4,
    },
    {
      requestId: rqB1,
      siteId: siteB,
      siteLocationId: locB1,
      workAreaId: waB1,
      shiftDefinitionId: shB1,
      date: "2026-01-05",
      headcount: 5,
    },
  ]);

  return {
    ids: { siteA, siteB, locA1, locA2, locB1 },
    notes,
    counts: { rqA1Lines: 2, rqA2Lines: 1, rqB1Lines: 5 },
    async cleanup() {
      for (const id of [rqA1, rqA2, rqB1]) {
        await db.delete(mpRequestLine).where(eq(mpRequestLine.requestId, id));
        await db.delete(mpRequest).where(eq(mpRequest.id, id));
      }
      for (const id of [waA1, waA2, waB1]) {
        await db.delete(workArea).where(eq(workArea.id, id));
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
      expect(html.includes(fx.notes.rqA1)).toBeTrue();
      expect(html.includes(fx.notes.rqA2)).toBeTrue();
      expect(html.includes(fx.notes.rqB1)).toBeFalse();
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
      expect(html.includes(fx.notes.rqA1)).toBeTrue();
      expect(html.includes(fx.notes.rqA2)).toBeFalse();
      expect(html.includes(fx.notes.rqB1)).toBeFalse();
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
      expect(html.includes(fx.notes.rqA1)).toBeTrue();
      expect(html.includes(fx.notes.rqA2)).toBeTrue();
      expect(html.includes(fx.notes.rqB1)).toBeTrue();
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

      const html = await renderRequests({ status: "received" });
      expect(html.includes(fx.notes.rqA1)).toBeFalse();
      expect(html.includes(fx.notes.rqA2)).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("the type URL filter narrows to matching types", async () => {
    const fx = await seedRequestFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const html = await renderRequests({ type: "daily" });
      expect(html.includes(fx.notes.rqA1)).toBeFalse();
      expect(html.includes(fx.notes.rqA2)).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });
});
