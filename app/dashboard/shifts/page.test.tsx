import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, shiftDefinition } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The shifts page reads its actor through requireUser (all three roles see
// the page; scope differs per role) — swapped for a stub so the real server
// component can render against the test database. The mock swaps the WHOLE
// module across bun's single test process, so every export other suites may
// resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// The tree the page hands back renders client tables (DataTable,
// StatusFilter) that read navigation hooks; no Next request context exists
// under bun test, so next/navigation is stubbed. The dialog module's
// "use server" imports pull next/cache at module scope — stubbed the same way.
mock.module("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
  useRouter: () => ({}),
  usePathname: () => "/dashboard/shifts",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

async function renderShifts(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  const { default: ShiftsPage } = await import("./page");
  const tree = await ShiftsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  return renderToStaticMarkup(tree);
}

// Shared fixture: site A (locations LA1, LA2) holds SH1 under LA1 and SH2
// under LA2; site B (location LB1) holds SH3. Labels embed uuid slices so
// suites on the shared dev DB can never collide. Child-first cleanup.
async function seedShiftFixtures() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locA2 = randomUUID();
  const locB1 = randomUUID();
  const shA1 = randomUUID();
  const shA2 = randomUUID();
  const shB1 = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const labels = {
    shA1: `t-sp-alpha-${suffix}`,
    shA2: `t-sp-own-two-${suffix}`,
    shB1: `t-sp-foreign-${suffix}`,
  };
  await db.insert(site).values([
    { id: siteA, name: `t-sp-site-a-${siteA}` },
    { id: siteB, name: `t-sp-site-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t-sp-loc-a1-${locA1}` },
    { id: locA2, siteId: siteA, name: `t-sp-loc-a2-${locA2}` },
    { id: locB1, siteId: siteB, name: `t-sp-loc-b1-${locB1}` },
  ]);
  await db.insert(shiftDefinition).values([
    {
      id: shA1,
      siteLocationId: locA1,
      siteId: siteA,
      label: labels.shA1,
      orderIndex: 1,
      startTime: "06:00",
      endTime: "14:00",
    },
    {
      id: shA2,
      siteLocationId: locA2,
      siteId: siteA,
      label: labels.shA2,
      orderIndex: 2,
      startTime: "14:00",
      endTime: "22:00",
    },
    {
      id: shB1,
      siteLocationId: locB1,
      siteId: siteB,
      label: labels.shB1,
      orderIndex: 1,
      startTime: "08:00",
      endTime: "16:00",
    },
  ]);
  return {
    ids: { siteA, siteB, locA1, locA2, locB1, shA1, shA2, shB1 },
    labels,
    async cleanup() {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shA1));
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shA2));
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shB1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB1));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
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
    name: "T-SP Actor",
    email: `t-sp-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// Spec §3.1: an ho manages their own site's shifts — the manage UI renders
// for them too; only the row scope differs by role.
describe("shifts page SSR (mp-requests Task 4)", () => {
  test("renders the Shifts heading and an ho's own-site rows with the manage UI", async () => {
    const fx = await seedShiftFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteA, null);

      const html = await renderShifts();
      expect(html.includes("Shifts")).toBeTrue();
      expect(html.includes(fx.labels.shA1)).toBeTrue();
      expect(html.includes(fx.labels.shA2)).toBeTrue();
      expect(html.includes(fx.labels.shB1)).toBeFalse();
      expect(html.includes("Add shift")).toBeTrue();
      expect(html.includes(`Actions for ${fx.labels.shA1}`)).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("admin sees only their own location's shifts and the create button", async () => {
    const fx = await seedShiftFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locA1);

      const html = await renderShifts();
      expect(html.includes(fx.labels.shA1)).toBeTrue();
      expect(html.includes(fx.labels.shA2)).toBeFalse();
      expect(html.includes(fx.labels.shB1)).toBeFalse();
      expect(html.includes("Add shift")).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("superadmin sees every site's shifts", async () => {
    const fx = await seedShiftFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      const html = await renderShifts();
      expect(html.includes(fx.labels.shA1)).toBeTrue();
      expect(html.includes(fx.labels.shA2)).toBeTrue();
      expect(html.includes(fx.labels.shB1)).toBeTrue();
      expect(html.includes("Add shift")).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("an unbound admin's empty scope shows the first-shift empty state", async () => {
    actor = makeActor("admin", null, null);

    const html = await renderShifts();
    expect(html.includes("Create your first shift for this location")).toBeTrue();
  });
});
