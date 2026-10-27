import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  position,
  shiftDefinition,
  site,
  siteLocation,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The create page reads its actor through requireUser and refuses ho actors
// with notFound() — swapped for stubs so the real server component can
// render against the test database. The mock swaps the WHOLE module across
// bun's single test process, so every export other suites may resolve must
// exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// RequestFormPage calls useRouter; no Next request context exists under bun
// test, so next/navigation is stubbed (notFound throws the way the real
// one surfaces a 404). The form module's "use server" imports pull
// next/cache at module scope — stubbed the same way.
mock.module("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({}),
  usePathname: () => "/dashboard/requests/new",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

async function renderNew(): Promise<string> {
  const { default: NewRequestPage } = await import("./page");
  const tree = await NewRequestPage();
  return renderToStaticMarkup(tree);
}

// Fixture: one site with two locations, but only the first (LA) carries an
// active work area (+ its required Operator position) + shift so the
// pinned-admin render can prove its masters shrink to the binding. No
// request rows — the create page reads masters and location options only.
// Child-first cleanup (pivot before workArea, position before site).
async function seedNewFixtures() {
  const siteId = randomUUID();
  const locA = randomUUID();
  const locB = randomUUID();
  const waA = randomUUID();
  const shA = randomUUID();
  const posA = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const locNames = {
    a: `t128-new-loc-a-${suffix}`,
    b: `t128-new-loc-b-${suffix}`,
  };

  await db.insert(site).values({ id: siteId, name: `t128-new-site-${siteId}` });
  await db.insert(siteLocation).values([
    { id: locA, siteId, name: locNames.a },
    { id: locB, siteId, name: locNames.b },
  ]);
  await db.insert(workArea).values({
    id: waA,
    siteId,
    siteLocationId: locA,
    name: `t128-new-wa-a-${suffix}`,
  });
  await db.insert(shiftDefinition).values({
    id: shA,
    siteId,
    siteLocationId: locA,
    label: `t128-new-shift-a-${suffix}`,
    orderIndex: 1,
    startTime: "06:00",
    endTime: "14:00",
  });
  await db.insert(position).values({
    id: posA,
    siteId,
    name: `t128-new-pos-a-${suffix}`,
  });
  await db.insert(workAreaPosition).values({
    workAreaId: waA,
    positionId: posA,
    siteId,
    siteLocationId: locA,
  });

  return {
    ids: { siteId, locA, locB },
    locNames,
    async cleanup() {
      await db
        .delete(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, waA));
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shA));
      await db.delete(workArea).where(eq(workArea.id, waA));
      await db.delete(position).where(eq(position.id, posA));
      await db
        .delete(siteLocation)
        .where(eq(siteLocation.id, locA));
      await db
        .delete(siteLocation)
        .where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteId));
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
    name: "T-NEW Actor",
    email: `t128-new-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

describe("new request page SSR (requests #128)", () => {
  test("superadmin renders the full-page form over every location", async () => {
    const fx = await seedNewFixtures();
    actor = makeActor("superadmin", null, null);
    try {
      const html = await renderNew();
      expect(html.includes("New request")).toBeTrue();
      expect(html.includes('href="/dashboard/requests"')).toBeTrue();
      expect(html.includes('id="request-week-start"')).toBeTrue();
      // Not pinned: no read-only location input carrying a location name.
      expect(html.includes(`value="${fx.locNames.a}"`)).toBeFalse();
      expect(html.includes(`value="${fx.locNames.b}"`)).toBeFalse();
      // Empty anchor → the form's existing guard paragraph.
      expect(
        html.includes("Pick a week to open the requirement grid."),
      ).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("a pinned admin sees only their location, server-side", async () => {
    const fx = await seedNewFixtures();
    actor = makeActor("admin", null, fx.ids.locA);
    try {
      const html = await renderNew();
      // Read-only pinned name instead of a picker; the other location's
      // option never arrives from the server.
      expect(html.includes(fx.locNames.a)).toBeTrue();
      expect(html.includes("Select a location")).toBeFalse();
      expect(html.includes(fx.locNames.b)).toBeFalse();
      // Empty anchor → the form's existing guard paragraph; the copy step
      // waits for a week, and the old Add bar is gone.
      expect(
        html.includes("Pick a week to open the requirement grid."),
      ).toBeTrue();
      expect(html.includes("Start blank")).toBeFalse();
      expect(html.includes("Add rows")).toBeFalse();
      expect(html.includes('id="request-add-work-area"')).toBeFalse();
    } finally {
      await fx.cleanup();
    }
  });

  test("an unbound admin sees the empty-options form", async () => {
    const fx = await seedNewFixtures();
    actor = makeActor("admin", null, null);
    try {
      const html = await renderNew();
      expect(html.includes("Select a location")).toBeTrue();
      expect(html.includes(fx.locNames.a)).toBeFalse();
      expect(html.includes(fx.locNames.b)).toBeFalse();
    } finally {
      await fx.cleanup();
    }
  });

  test("ho gets a 404", async () => {
    const fx = await seedNewFixtures();
    actor = makeActor("ho", fx.ids.siteId, null);
    try {
      let caught: unknown;
      try {
        await renderNew();
      } catch (err) {
        caught = err;
      }
      expect((caught as Error | undefined)?.message).toContain("not-found");
    } finally {
      await fx.cleanup();
    }
  });
});
