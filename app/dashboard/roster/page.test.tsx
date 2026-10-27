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
  rosterAssignment,
  rosterPlan,
  shiftDefinition,
  site,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
  worker,
  workerPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The roster page reads its actor through requireUser (all three roles view
// the page; scope + write surface differ per role) — swapped for a stub so
// the real server component can render against the test database. The mock
// swaps the WHOLE module across bun's single test process, so every export
// other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// The tree the page hands back renders client components (tabs, popover
// triggers, DataTable) that read navigation hooks; no Next request context
// exists under bun test, so next/navigation is stubbed. The view modules'
// "use server" imports pull next/cache at module scope — stubbed too.
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
  usePathname: () => "/dashboard/roster",
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

// Visible text only: tags (and React's text-node comments) stripped.
const text = (html: string): string => html.replace(/<[^>]+>/g, "");

async function renderRoster(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<string> {
  const { default: RosterPage } = await import("./page");
  const tree = await RosterPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  return renderToStaticMarkup(tree);
}

// Shared fixture: site S holds locations L1/L2. L1 carries two work areas,
// two shifts, 55 workers (one slice + spare), an approved weekly request
// with two requirement lines for the week, a daily request mid-week, and a
// DRAFT weekly plan with one assignment. L2 carries a second draft plan for
// the superadmin scope case. Child-first cleanup.
async function seedRosterFixtures() {
  const suffix = randomUUID().slice(0, 8);
  const siteS = randomUUID();
  const locL1 = randomUUID();
  const locL2 = randomUUID();
  const waOne = randomUUID();
  const waTwo = randomUUID();
  const waL2 = randomUUID();
  const posOne = randomUUID();
  const shEarly = randomUUID();
  const shLate = randomUUID();
  const shL2 = randomUUID();
  const reqWeekly = randomUUID();
  const reqDaily = randomUUID();
  const reqDailyDone = randomUUID();
  const reqOpenWeek = randomUUID();
  const reqApprovedWeek = randomUUID();
  const reqLate = randomUUID();
  const publishedLate = randomUUID();
  const draftL1 = randomUUID();
  const draftL2 = randomUUID();
  const publishedL1 = randomUUID();
  const creator = `t-roster-creator-${randomUUID().slice(0, 8)}`;
  const MONDAY = "2026-01-05"; // a Monday
  const OPEN_MONDAY = "2026-01-12"; // only an open (unapproved) request, no plan
  const APPROVED_MONDAY = "2026-01-19"; // an approved request, no plan yet
  const LATE_MONDAY = "2026-01-26"; // published plan, then a late approval

  const workerIds = Array.from({ length: 55 }, () => randomUUID());
  const employeeId = (n: number): string =>
    `t-roster-emp-${suffix}-${String(n).padStart(3, "0")}`;

  await db.insert(user).values({
    id: creator,
    name: creator,
    email: `${creator}@shiftly.test`,
    role: "superadmin",
  });
  await db.insert(site).values({ id: siteS, name: `t-roster-site-${suffix}` });
  await db.insert(siteLocation).values([
    { id: locL1, siteId: siteS, name: `t-roster-loc-1-${suffix}` },
    { id: locL2, siteId: siteS, name: `t-roster-loc-2-${suffix}` },
  ]);
  await db.insert(workArea).values([
    { id: waOne, siteLocationId: locL1, siteId: siteS, name: `t-roster-wa-one-${suffix}` },
    { id: waTwo, siteLocationId: locL1, siteId: siteS, name: `t-roster-wa-two-${suffix}` },
    { id: waL2, siteLocationId: locL2, siteId: siteS, name: `t-roster-wa-l2-${suffix}` },
  ]);
  await db.insert(position).values({
    id: posOne,
    siteId: siteS,
    name: `t-roster-pos-one-${suffix}`,
  });
  await db.insert(workAreaPosition).values({
    workAreaId: waOne,
    positionId: posOne,
    siteId: siteS,
    siteLocationId: locL1,
  });
  await db.insert(shiftDefinition).values([
    {
      id: shEarly,
      siteLocationId: locL1,
      siteId: siteS,
      label: `t-roster-shift-early-${suffix}`,
      orderIndex: 1,
      startTime: "06:00",
      endTime: "14:00",
    },
    {
      id: shLate,
      siteLocationId: locL1,
      siteId: siteS,
      label: `t-roster-shift-late-${suffix}`,
      orderIndex: 2,
      startTime: "14:00",
      endTime: "22:00",
    },
    {
      id: shL2,
      siteLocationId: locL2,
      siteId: siteS,
      label: `t-roster-shift-l2-${suffix}`,
      orderIndex: 1,
      startTime: "08:00",
      endTime: "16:00",
    },
  ]);
  await db.insert(worker).values(
    workerIds.map((id, index) => ({
      id,
      siteLocationId: locL1,
      siteId: siteS,
      employeeId: employeeId(index + 1),
      name: `t-roster-worker-${suffix}-${index + 1}`,
    })),
  );
  // The card requires posOne, so every sliced worker holds it (the profile
  // loader admits only workers holding one of the area's positions).
  await db.insert(workerPosition).values(
    workerIds.map((id) => ({ workerId: id, positionId: posOne, siteId: siteS })),
  );
  await db.insert(mpRequest).values([
    {
      id: reqWeekly,
      siteId: siteS,
      siteLocationId: locL1,
      type: "weekly",
      status: "approved",
      weekStart: MONDAY,
      createdBy: creator,
    },
    {
      id: reqDaily,
      siteId: siteS,
      siteLocationId: locL1,
      type: "daily",
      status: "open",
      requestDate: "2026-01-07",
      createdBy: creator,
    },
    {
      id: reqDailyDone,
      siteId: siteS,
      siteLocationId: locL1,
      type: "daily",
      status: "fulfilled",
      requestDate: "2026-01-08",
      createdBy: creator,
    },
    {
      id: reqOpenWeek,
      siteId: siteS,
      siteLocationId: locL1,
      type: "weekly",
      status: "open",
      weekStart: OPEN_MONDAY,
      createdBy: creator,
    },
    {
      id: reqApprovedWeek,
      siteId: siteS,
      siteLocationId: locL1,
      type: "weekly",
      status: "approved",
      weekStart: APPROVED_MONDAY,
      createdBy: creator,
    },
    {
      id: reqLate,
      siteId: siteS,
      siteLocationId: locL1,
      type: "weekly",
      status: "approved",
      weekStart: LATE_MONDAY,
      createdBy: creator,
    },
  ]);
  const line = (
    requestId: string,
    date: string,
    headcount: number,
  ) => ({
    requestId,
    siteId: siteS,
    siteLocationId: locL1,
    workAreaId: waOne,
    shiftDefinitionId: shEarly,
    positionId: posOne,
    date,
    headcount,
  });
  await db.insert(mpRequestLine).values([
    line(reqDailyDone, "2026-01-08", 1),
    line(reqOpenWeek, OPEN_MONDAY, 1),
    line(reqApprovedWeek, "2026-01-19", 1),
    line(reqApprovedWeek, "2026-01-20", 1),
    line(reqApprovedWeek, "2026-01-21", 1),
    line(reqLate, LATE_MONDAY, 2),
  ]);
  await db.insert(mpRequestLine).values([
    {
      requestId: reqWeekly,
      siteId: siteS,
      siteLocationId: locL1,
      workAreaId: waOne,
      shiftDefinitionId: shEarly,
      positionId: posOne,
      date: MONDAY,
      headcount: 2,
    },
    {
      requestId: reqWeekly,
      siteId: siteS,
      siteLocationId: locL1,
      workAreaId: waOne,
      shiftDefinitionId: shEarly,
      positionId: posOne,
      date: "2026-01-06",
      headcount: 2,
    },
    {
      requestId: reqDaily,
      siteId: siteS,
      siteLocationId: locL1,
      workAreaId: waOne,
      shiftDefinitionId: shEarly,
      positionId: posOne,
      date: "2026-01-07",
      headcount: 2,
    },
  ]);
  await db.insert(rosterPlan).values([
    {
      id: draftL1,
      siteId: siteS,
      siteLocationId: locL1,
      kind: "weekly",
      weekStart: MONDAY,
      status: "draft",
      version: 1,
      rulesSnapshot: {
        c1: { value: 6, source: "default" },
        c2: { value: 20, source: "default" },
        c3: { value: false, source: "default" },
        c4: { value: false, source: "default" },
        c5: { value: 6, source: "default" },
        c6: { value: 1, source: "default" },
        c7: { value: false, source: "default" },
      },
      generatedBy: creator,
    },
    {
      id: draftL2,
      siteId: siteS,
      siteLocationId: locL2,
      kind: "weekly",
      weekStart: MONDAY,
      status: "draft",
      version: 1,
      rulesSnapshot: {
        c1: { value: 6, source: "default" },
        c2: { value: 20, source: "default" },
        c3: { value: false, source: "default" },
        c4: { value: false, source: "default" },
        c5: { value: 6, source: "default" },
        c6: { value: 1, source: "default" },
        c7: { value: false, source: "default" },
      },
      generatedBy: creator,
    },
    {
      id: publishedL1,
      siteId: siteS,
      siteLocationId: locL1,
      kind: "weekly",
      weekStart: MONDAY,
      status: "published",
      version: 1,
      rulesSnapshot: {
        c1: { value: 6, source: "default" },
        c2: { value: 20, source: "default" },
        c3: { value: false, source: "default" },
        c4: { value: false, source: "default" },
        c5: { value: 6, source: "default" },
        c6: { value: 1, source: "default" },
        c7: { value: false, source: "default" },
      },
      publishedAt: new Date(),
      publishedBy: creator,
      generatedBy: creator,
    },
    {
      id: publishedLate,
      siteId: siteS,
      siteLocationId: locL1,
      kind: "weekly",
      weekStart: LATE_MONDAY,
      status: "published",
      version: 1,
      rulesSnapshot: {
        c1: { value: 6, source: "default" },
        c2: { value: 20, source: "default" },
        c3: { value: false, source: "default" },
        c4: { value: false, source: "default" },
        c5: { value: 6, source: "default" },
        c6: { value: 1, source: "default" },
        c7: { value: false, source: "default" },
      },
      publishedAt: new Date(),
      publishedBy: creator,
      generatedBy: creator,
    },
  ]);
  await db.insert(rosterAssignment).values({
    planId: draftL1,
    siteId: siteS,
    siteLocationId: locL1,
    workerId: workerIds[0],
    workAreaId: waOne,
    shiftDefinitionId: shEarly,
    date: MONDAY,
  });

  return {
    ids: { siteS, locL1, locL2, waOne, waTwo, shEarly, draftL1, draftL2, publishedL1 },
    labels: {
      areaOne: `t-roster-wa-one-${suffix}`,
      areaTwo: `t-roster-wa-two-${suffix}`,
      shiftEarly: `t-roster-shift-early-${suffix}`,
      posOne: `t-roster-pos-one-${suffix}`,
      loc1: `t-roster-loc-1-${suffix}`,
      loc2: `t-roster-loc-2-${suffix}`,
    },
    employeeId,
    MONDAY,
    OPEN_MONDAY,
    APPROVED_MONDAY,
    LATE_MONDAY,
    async cleanup() {
      await db.delete(rosterAssignment).where(eq(rosterAssignment.planId, draftL1));
      for (const id of [draftL1, draftL2, publishedL1, publishedLate]) {
        await db.delete(rosterPlan).where(eq(rosterPlan.id, id));
      }
      for (const id of [
        reqWeekly,
        reqDaily,
        reqDailyDone,
        reqOpenWeek,
        reqApprovedWeek,
        reqLate,
      ]) {
        await db.delete(mpRequestLine).where(eq(mpRequestLine.requestId, id));
        await db.delete(mpRequest).where(eq(mpRequest.id, id));
      }
      // Pivots first: they RESTRICT to worker / work_area rows.
      await db.delete(workerPosition).where(eq(workerPosition.positionId, posOne));
      await db.delete(worker).where(eq(worker.siteLocationId, locL1));
      for (const id of [shEarly, shLate, shL2]) {
        await db.delete(shiftDefinition).where(eq(shiftDefinition.id, id));
      }
      await db.delete(workAreaPosition).where(eq(workAreaPosition.workAreaId, waOne));
      for (const id of [waOne, waTwo, waL2]) {
        await db.delete(workArea).where(eq(workArea.id, id));
      }
      await db.delete(position).where(eq(position.id, posOne));
      for (const id of [locL1, locL2]) {
        await db.delete(siteLocation).where(eq(siteLocation.id, id));
      }
      await db.delete(site).where(eq(site.id, siteS));
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
    name: "T-Roster Actor",
    email: `t-roster-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

describe("roster page SSR (roster-engine Task 7)", () => {
  test("an admin's draft renders grid headers, the sliced worker rows and the picker cells", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const html = await renderRoster({ week: fx.MONDAY });

      // Grid headers: the Monday-start week.
      for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
        expect(html.includes(day)).toBeTrue();
      }
      // The work-area card and the cell picker cells of an editable draft.
      expect(html.includes(fx.labels.areaOne)).toBeTrue();
      expect(html.includes("Open shift picker")).toBeTrue();
      // The worker slice: exactly one 50-row page of 55, first worker in.
      expect(html.includes(fx.employeeId(1))).toBeTrue();
      expect(html.includes(fx.employeeId(51))).toBeFalse();
      expect(html.includes("50 of 55")).toBeTrue();
      // Plan list: the location's draft is auto-selected.
      expect(html.includes("Draft")).toBeTrue();
      // A draft's one primary button is Publish; Generate is not offered.
      expect(html.includes("Publish roster")).toBeTrue();
      expect(html.includes("Generate draft")).toBeFalse();
      // The empty-week explanation must NOT appear on a covered week.
      expect(
        html.includes("No request approved by HO for this week"),
      ).toBeFalse();
    } finally {
      await fx.cleanup();
    }
  });

  test("the worker slice honors the rowPage URL param", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const html = await renderRoster({ week: fx.MONDAY, rowPage: "2" });

      expect(html.includes(fx.employeeId(55))).toBeTrue();
      expect(html.includes(fx.employeeId(1))).toBeFalse();
      expect(html.includes("5 of 55")).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("generate is disabled with the HO reason when the week has only open requests", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const html = await renderRoster({ week: fx.OPEN_MONDAY });

      expect(html.includes("Generate draft")).toBeTrue();
      expect(
        html.includes("No request approved by HO for this week"),
      ).toBeTrue();
      // The generate trigger is rendered disabled (the explanation rides
      // the same gate).
      const trigger = html.indexOf("Generate draft");
      expect(html.slice(Math.max(0, trigger - 3000), trigger)).toContain(
        'disabled=""',
      );
    } finally {
      await fx.cleanup();
    }
  });

  test('generate is enabled with "N slots from M requests" when an approved request exists', async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const html = await renderRoster({ week: fx.APPROVED_MONDAY });

      expect(text(html)).toContain("3 slots from 1 request");
      expect(html.includes("No request approved by HO")).toBeFalse();
      const trigger = html.indexOf("Generate draft");
      expect(trigger).toBeGreaterThan(-1);
      expect(html.slice(Math.max(0, trigger - 3000), trigger)).not.toContain(
        'disabled=""',
      );
    } finally {
      await fx.cleanup();
    }
  });

  test("draft week shows the filled/required totals and the requirements rows", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const page = text(await renderRoster({ week: fx.MONDAY }));

      // Weekly demand 2+2 with one assignment, plus the open daily slot of 2.
      expect(page).toContain("Draft v1 · 1/6 filled");
      expect(page).toContain(`${fx.labels.areaOne} · ${fx.labels.shiftEarly}`);
      expect(page).toContain("1/4");
      expect(page).toContain("3 short");
      expect(page).toContain(`${fx.labels.posOne} 4`);
    } finally {
      await fx.cleanup();
    }
  });

  test("daily open slot appears in the panel, fulfilled daily request does not", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const html = await renderRoster({ week: fx.MONDAY });
      const page = text(html);

      expect(page).toContain("daily · 2026-01-07");
      expect(page).not.toContain("daily · 2026-01-08");
      expect(page).toContain("Suggest replacements");
      // The old daily table is gone.
      expect(page).not.toContain("Daily requests");
    } finally {
      await fx.cleanup();
    }
  });

  test("ho sees no primary button", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteS, null);

      const page = text(await renderRoster({ week: fx.MONDAY }));

      expect(page).toContain("Draft v1");
      for (const label of [
        "Generate draft",
        "Publish roster",
        "Revise plan",
        "Suggest replacements",
      ]) {
        expect(page).not.toContain(label);
      }
    } finally {
      await fx.cleanup();
    }
  });

  test("late approved request after a published plan shows as unfilled demand and a Revise action", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const page = text(await renderRoster({ week: fx.LATE_MONDAY }));

      expect(page).toContain("Published v1 · 0/2 filled");
      expect(page).toContain(`${fx.labels.areaOne} · ${fx.labels.shiftEarly}`);
      expect(page).toContain("2 short");
      expect(page).toContain("Revise plan");
      expect(page).not.toContain("Publish roster");
    } finally {
      await fx.cleanup();
    }
  });

  test("a superadmin's locationId param scopes the plan and requirements to that location", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      const page = text(
        await renderRoster({ week: fx.MONDAY, locationId: fx.ids.locL2 }),
      );

      // L2's draft is chosen and L1's demand does not leak into the panel.
      expect(page).toContain(fx.labels.loc2);
      expect(page).toContain("Draft v1");
      expect(page).not.toContain(fx.labels.areaOne);
      expect(page).toContain("No approved requests for this week");
    } finally {
      await fx.cleanup();
    }
  });

  test("an ho sees the read-only grid of their site's plans without write entries", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteS, null);

      const html = await renderRoster({ week: fx.MONDAY });

      // Read-only grid of the site's plans (both locations) renders.
      expect(html.includes(fx.labels.areaOne)).toBeTrue();
      expect(html.includes(fx.employeeId(1))).toBeTrue();
      expect(html.includes("Read-only")).toBeTrue();
      expect(html.includes("Open shift picker")).toBeFalse();
      expect(html.includes("Generate draft")).toBeFalse();
      expect(html.includes("Publish")).toBeFalse();
    } finally {
      await fx.cleanup();
    }
  });

  test("a superadmin can open any location's plan of the week", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("superadmin", null, null);

      // The plan picker renders closed, so assert each location's plan is
      // reachable by deep-linking its id (the closed list shows the
      // selected plan's name only).
      const html = await renderRoster({
        week: fx.MONDAY,
        planId: fx.ids.draftL2,
      });
      expect(html.includes(fx.labels.loc2)).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });

  test("a published plan offers Revise plan to an admin (copy-on-edit entry)", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      // Deep-link the published plan: the page prefers drafts otherwise.
      const html = await renderRoster({
        week: fx.MONDAY,
        planId: fx.ids.publishedL1,
      });

      expect(html.includes("Revise plan")).toBeTrue();
      expect(
        html.includes("Published — locked; revise to open the next draft."),
      ).toBeTrue();
      expect(html.includes("Open shift picker")).toBeFalse();
    } finally {
      await fx.cleanup();
    }
  });

  test("an ho's published plan shows no Revise plan entry", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("ho", fx.ids.siteS, null);

      const html = await renderRoster({
        week: fx.MONDAY,
        planId: fx.ids.publishedL1,
      });

      expect(html.includes("Revise plan")).toBeFalse();
      expect(html.includes("Read-only")).toBeTrue();
    } finally {
      await fx.cleanup();
    }
  });
});
