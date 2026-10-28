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
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

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
const realNavigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...realNavigation,
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
// Real exports kept (revalidateTag, updateTag, … stay available to suites that
// run after this one: module mocks are process-wide); only revalidatePath is
// replaced, since there is no Next request context under bun test.
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
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
// request was filed. An open weekly request under LOC carries one line
// for each pair. A second open request lives under another site's
// location (foreign), and an approved one under LOC (non-open).
// Child-first cleanup.
async function seedEditFixtures() {
  const siteId = randomUUID();
  const locId = randomUUID();
  const waActive = randomUUID();
  const shActive = randomUUID();
  const waOld = randomUUID();
  const shOld = randomUUID();
  const posActive = randomUUID();
  const posOld = randomUUID();
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
    posActive: `t129-edit-pos-active-${suffix}`,
    posOld: `t129-edit-pos-old-${suffix}`,
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
  await db.insert(position).values([
    { id: posActive, siteId, name: names.posActive },
    // Deactivated with its area after the request was filed — the stored
    // line must still surface as a removable inactive line, never vanish.
    { id: posOld, siteId, name: names.posOld, isActive: false },
  ]);
  await db.insert(workAreaPosition).values([
    { workAreaId: waActive, positionId: posActive, siteId, siteLocationId: locId },
    { workAreaId: waOld, positionId: posOld, siteId, siteLocationId: locId },
  ]);
  await db.insert(mpRequest).values([
    {
      id: rqSubmitted,
      siteId,
      siteLocationId: locId,
      type: "weekly",
      status: "open",
      weekStart: monday,
      createdBy: creator,
    },
    {
      id: rqForeign,
      siteId: otherSiteId,
      siteLocationId: otherLocId,
      type: "weekly",
      status: "open",
      weekStart: monday,
      createdBy: creator,
    },
    {
      id: rqReceived,
      siteId,
      siteLocationId: locId,
      type: "weekly",
      status: "approved",
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
      positionId: posActive,
      date: "2026-01-05",
      headcount: 3,
    },
    {
      requestId: rqSubmitted,
      siteId,
      siteLocationId: locId,
      workAreaId: waOld,
      shiftDefinitionId: shOld,
      positionId: posOld,
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
      await db
        .delete(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, waActive));
      await db
        .delete(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, waOld));
      for (const id of [waActive, waOld]) {
        await db.delete(workArea).where(eq(workArea.id, id));
      }
      for (const id of [shActive, shOld]) {
        await db.delete(shiftDefinition).where(eq(shiftDefinition.id, id));
      }
      for (const id of [posActive, posOld]) {
        await db.delete(position).where(eq(position.id, id));
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
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
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
      html.includes(
        `Remove inactive line ${fx.names.waOld} / ${fx.names.shOld} / ${fx.names.posOld}`,
      ),
    ).toBeTrue();
    // The stored active line's area opens as its own section; edit has
    // no copy step and no Add bar.
    expect(
      html.includes(`aria-label="Remove area ${fx.names.waActive}"`),
    ).toBeTrue();
    expect(
      html.includes(
        `aria-label="Headcount ${fx.names.waActive} / ${fx.names.shActive} / ${fx.names.posActive} / 2026-01-05"`,
      ),
    ).toBeTrue();
    expect(html.includes("Start blank")).toBeFalse();
    expect(html.includes("Add rows")).toBeFalse();
  });

  test("a non-open request 404s", async () => {
    const fx = await seedEditFixtures();
    actor = makeActor("superadmin", null, null);
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await expectNotFound(fx.ids.rqReceived);
  });

  test("a foreign/out-of-scope request 404s", async () => {
    const fx = await seedEditFixtures();
    // Bound to the wrong location: the row is outside mpRequestMutationWhere.
    actor = makeActor("admin", null, null);
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await expectNotFound(fx.ids.rqForeign);
  });

  test("ho 404s even on their own site's request", async () => {
    const fx = await seedEditFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    // (siteId not needed — role check fails first)
    actor = makeActor("ho", null, null);
    await expectNotFound(fx.ids.rqSubmitted);
  });
});
