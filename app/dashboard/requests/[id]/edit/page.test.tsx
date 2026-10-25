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

// The edit page reads its actor through requireUser and refuses ineligible
// actors/ids with notFound() — swapped for stubs so the real server
// component can render against the test database. The mock swaps the WHOLE
// module across bun's single test process, so every export other suites
// may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// RequestFormPage calls useRouter; no Next request context exists under bun
// test, so next/navigation is stubbed. The form module's "use server"
// imports pull next/cache at module scope — stubbed the same way.
mock.module("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({}),
  usePathname: () => "/dashboard/requests/edit",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

async function renderEdit(id: string): Promise<string> {
  const { default: EditRequestPage } = await import("./page");
  const tree = await EditRequestPage({
    params: Promise.resolve({ id }),
  } as never);
  return renderToStaticMarkup(tree);
}

async function expectNotFound(id: string) {
  let caught: unknown;
  try {
    await renderEdit(id);
  } catch (err) {
    caught = err;
  }
  expect((caught as Error | undefined)?.message).toContain("not-found");
}

// Fixture: the editing actor's site S holds location LOC with two work
// areas and two shifts — one active pair, one pair deactivated after the
// request was filed. A submitted weekly request under LOC carries one line
// for each pair. A second submitted request lives under another site's
// location (foreign), and a received one under LOC (non-submitted).
// Child-first cleanup.
async function seedEditFixtures() {
  const siteId = randomUUID();
  const locId = randomUUID();
  const waActive = randomUUID();
  const shActive = randomUUID();
  const waOld = randomUUID();
  const shOld = randomUUID();
  const otherSiteId = randomUUID();
  const otherLocId = randomUUID();
  const rqSubmitted = randomUUID();
  const rqForeign = randomUUID();
  const rqReceived = randomUUID();
  const creator = `t129-edit-creator-${randomUUID().slice(0, 8)}`;
  const suffix = randomUUID().slice(0, 8);
  const monday = "2026-01-05"; // a Monday
  const names = {
    waActive: `t129-edit-wa-active-${suffix}`,
    shActive: `t129-edit-sh-active-${suffix}`,
    waOld: `t129-edit-wa-old-${suffix}`,
    shOld: `t129-edit-sh-old-${suffix}`,
  };

  await db.insert(user).values({
    id: creator,
    name: creator,
    email: `${creator}@shiftly.test`,
    role: "superadmin",
  });
  await db.insert(site).values([
    { id: siteId, name: `t129-edit-site-${siteId}` },
    { id: otherSiteId, name: `t129-edit-site-b-${otherSiteId}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locId, siteId, name: `t129-edit-loc-${locId}` },
    {
      id: otherLocId,
      siteId: otherSiteId,
      name: `t129-edit-loc-b-${otherLocId}`,
    },
  ]);
  await db.insert(workArea).values([
    {
      id: waActive,
      siteId,
      siteLocationId: locId,
      name: names.waActive,
      isActive: true,
    },
    {
      // Deactivated after the request was filed — its stored line must
      // still surface as a removable inactive pair, never vanish.
      id: waOld,
      siteId,
      siteLocationId: locId,
      name: names.waOld,
      isActive: false,
    },
  ]);
  await db.insert(shiftDefinition).values([
    {
      id: shActive,
      siteId,
      siteLocationId: locId,
      label: names.shActive,
      orderIndex: 1,
      startTime: "06:00",
      endTime: "14:00",
      isActive: true,
    },
    {
      id: shOld,
      siteId,
      siteLocationId: locId,
      label: names.shOld,
      orderIndex: 2,
      startTime: "14:00",
      endTime: "22:00",
      isActive: false,
    },
  ]);
  await db.insert(mpRequest).values([
    {
      id: rqSubmitted,
      siteId,
      siteLocationId: locId,
      type: "weekly",
      status: "submitted",
      weekStart: monday,
      createdBy: creator,
    },
    {
      id: rqForeign,
      siteId: otherSiteId,
      siteLocationId: otherLocId,
      type: "weekly",
      status: "submitted",
      weekStart: monday,
      createdBy: creator,
    },
    {
      id: rqReceived,
      siteId,
      siteLocationId: locId,
      type: "weekly",
      status: "received",
      weekStart: "2026-01-12", // one open weekly request per location/week
      createdBy: creator,
    },
  ]);
  await db.insert(mpRequestLine).values([
    {
      requestId: rqSubmitted,
      siteId,
      siteLocationId: locId,
      workAreaId: waActive,
      shiftDefinitionId: shActive,
      date: "2026-01-05",
      headcount: 3,
    },
    {
      requestId: rqSubmitted,
      siteId,
      siteLocationId: locId,
      workAreaId: waOld,
      shiftDefinitionId: shOld,
      date: "2026-01-06",
      headcount: 7,
    },
  ]);

  return {
    ids: { locId, rqSubmitted, rqForeign, rqReceived },
    names,
    async cleanup() {
      for (const id of [rqSubmitted, rqForeign, rqReceived]) {
        await db.delete(mpRequestLine).where(eq(mpRequestLine.requestId, id));
        await db.delete(mpRequest).where(eq(mpRequest.id, id));
      }
      for (const id of [waActive, waOld]) {
        await db.delete(workArea).where(eq(workArea.id, id));
      }
      for (const id of [shActive, shOld]) {
        await db.delete(shiftDefinition).where(eq(shiftDefinition.id, id));
      }
      for (const id of [locId, otherLocId]) {
        await db.delete(siteLocation).where(eq(siteLocation.id, id));
      }
      for (const id of [siteId, otherSiteId]) {
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
    name: "T-EDIT Actor",
    email: `t129-edit-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

describe("edit request page SSR (requests #129)", () => {
  test("an in-scope admin sees the edit form with stored lines, deactivated pair rendered as a removable inactive pair", async () => {
    const fx = await seedEditFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locId);
      const html = await renderEdit(fx.ids.rqSubmitted);
      expect(html.includes("Edit request lines")).toBeTrue();
      expect(html.includes('href="/dashboard/requests"')).toBeTrue();
      // Stored line values pre-fill the grid; the inactive pair's value
      // renders as read-only cell text, not an input.
      expect(html.includes('value="3"')).toBeTrue();
      expect(html.includes(">7</td>")).toBeTrue();
      // The since-deactivated pair still renders — removable, not dropped.
      expect(html.includes("Inactive — keep unchanged or remove")).toBeTrue();
      expect(
        html.includes(`Remove inactive line ${fx.names.waOld} / ${fx.names.shOld}`),
      ).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("a non-submitted request 404s", async () => {
    const fx = await seedEditFixtures();
    actor = makeActor("superadmin", null, null);
    try {
      await expectNotFound(fx.ids.rqReceived);
    } finally {
      await fx.cleanup();
    }
  });

  test("a foreign/out-of-scope request 404s", async () => {
    const fx = await seedEditFixtures();
    // Bound to the wrong location: the row is outside mpRequestMutationWhere.
    actor = makeActor("admin", null, null);
    try {
      await expectNotFound(fx.ids.rqForeign);
    } finally {
      await fx.cleanup();
    }
  });

  test("ho 404s even on their own site's request", async () => {
    const fx = await seedEditFixtures();
    try {
      // (siteId not needed — role check fails first)
      actor = makeActor("ho", null, null);
      await expectNotFound(fx.ids.rqSubmitted);
    } finally {
      await fx.cleanup();
    }
  });
});
