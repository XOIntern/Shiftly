import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  auditLog,
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
  const reqDailySibling = randomUUID();
  const dailyPlan = randomUUID();
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
      // Fulfilled sibling of the open daily request: same date, area and
      // shift. Its two fills live in the date's daily plan below.
      id: reqDailySibling,
      siteId: siteS,
      siteLocationId: locL1,
      type: "daily",
      status: "fulfilled",
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
    line(reqDailySibling, "2026-01-07", 2),
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
  // The 2026-01-07 daily plan holding the fulfilled sibling's two fills.
  await db.insert(rosterPlan).values({
    id: dailyPlan,
    siteId: siteS,
    siteLocationId: locL1,
    kind: "daily",
    requestDate: "2026-01-07",
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
  });
  await db.insert(rosterAssignment).values(
    [workerIds[1], workerIds[2]].map((workerId) => ({
      planId: dailyPlan,
      siteId: siteS,
      siteLocationId: locL1,
      workerId,
      workAreaId: waOne,
      shiftDefinitionId: shEarly,
      date: "2026-01-07",
    })),
  );

  return {
    ids: {
      siteS,
      locL1,
      locL2,
      waOne,
      waTwo,
      shEarly,
      draftL1,
      draftL2,
      publishedL1,
      dailyPlan,
    },
    workerIds,
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
      await db.delete(rosterAssignment).where(eq(rosterAssignment.planId, dailyPlan));
      for (const id of [draftL1, draftL2, publishedL1, publishedLate, dailyPlan]) {
        await db.delete(rosterPlan).where(eq(rosterPlan.id, id));
      }
      for (const id of [
        reqWeekly,
        reqDaily,
        reqDailyDone,
        reqDailySibling,
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

// The <tr> of one worker (grid rows split on the opening tag, so a chunk
// ends at its own </tr>).
const rowOf = (html: string, employeeId: string): string =>
  html.split("<tr").find((chunk) => chunk.includes(`>${employeeId}<`)) ?? "";

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

      // The title is where focus lands after a confirmed Discard removes
      // the draft and its trigger.
      const title = html.match(/<h1[^>]*>Roster<\/h1>/)?.[0] ?? "";
      expect(title).toContain(" data-focus-fallback=");
      expect(title).toContain('tabindex="-1"');

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

  test("the generate reason counts headcount, not request lines", async () => {
    const fx = await seedRosterFixtures();
    const requestId = randomUUID();
    const MULTI_MONDAY = "2026-02-02";
    try {
      actor = makeActor("admin", null, fx.ids.locL1);
      const [creatorRow] = await db
        .select({ id: user.id })
        .from(mpRequest)
        .innerJoin(user, eq(user.id, mpRequest.createdBy))
        .where(eq(mpRequest.siteLocationId, fx.ids.locL1))
        .limit(1);
      await db.insert(mpRequest).values({
        id: requestId,
        siteId: fx.ids.siteS,
        siteLocationId: fx.ids.locL1,
        type: "weekly",
        status: "approved",
        weekStart: MULTI_MONDAY,
        createdBy: creatorRow.id,
      });
      const [posRow] = await db
        .select({ positionId: mpRequestLine.positionId })
        .from(mpRequestLine)
        .where(eq(mpRequestLine.siteLocationId, fx.ids.locL1))
        .limit(1);
      const line = (date: string, headcount: number) => ({
        requestId,
        siteId: fx.ids.siteS,
        siteLocationId: fx.ids.locL1,
        workAreaId: fx.ids.waOne,
        shiftDefinitionId: fx.ids.shEarly,
        positionId: posRow.positionId,
        date,
        headcount,
      });
      await db
        .insert(mpRequestLine)
        .values([line("2026-02-02", 3), line("2026-02-03", 2)]);

      const page = text(await renderRoster({ week: MULTI_MONDAY }));

      expect(page).toContain("5 slots from 1 request");
      expect(page).not.toContain("2 slots from");
    } finally {
      await db.delete(mpRequestLine).where(eq(mpRequestLine.requestId, requestId));
      await db.delete(mpRequest).where(eq(mpRequest.id, requestId));
      await fx.cleanup();
    }
  });

  test("draft week shows the filled/required totals and the requirements rows", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);

      const page = text(await renderRoster({ week: fx.MONDAY }));

      // The plan's figure is weekly demand only (2+2, one assignment); the
      // open daily slot is not something a weekly draft can fill.
      expect(page).toContain("Draft v1 · 1/4 filled");
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
      // The fulfilled sibling's two fills on the same slot do not cover the
      // open request: its row stays 0/2 and short.
      expect(page).toMatch(/0\/2\s*daily · 2026-01-07\s*2 short/);
      expect(page).toContain("Suggest replacements");
      // The old daily table is gone.
      expect(page).not.toContain("Daily requests");
    } finally {
      await fx.cleanup();
    }
  });

  test("a daily fill shows as a read-only Daily cell in the worker's row, for an admin and an ho", async () => {
    const fx = await seedRosterFixtures();
    try {
      // The fixture's 2026-01-07 daily plan fills workers 2 and 3 of the
      // selected area; worker 1 has only the weekly Monday cell.
      for (const who of [
        makeActor("admin", null, fx.ids.locL1),
        makeActor("ho", fx.ids.siteS, null),
      ]) {
        actor = who;
        const html = await renderRoster({ week: fx.MONDAY });

        for (const n of [2, 3]) {
          const row = rowOf(html, fx.employeeId(n));
          expect(row).toContain("Daily");
          expect(row).toContain(fx.labels.shiftEarly);
          expect(row).not.toContain(
            `Open shift picker for ${fx.employeeId(n)} on 2026-01-07`,
          );
        }
        expect(text(rowOf(html, fx.employeeId(1)))).not.toContain("Daily");
      }
    } finally {
      await fx.cleanup();
    }
  });

  test("a daily fill of another work area does not show in the selected card", async () => {
    const fx = await seedRosterFixtures();
    try {
      await db.insert(rosterAssignment).values({
        planId: fx.ids.dailyPlan,
        siteId: fx.ids.siteS,
        siteLocationId: fx.ids.locL1,
        workerId: fx.workerIds[4],
        workAreaId: fx.ids.waTwo,
        shiftDefinitionId: fx.ids.shEarly,
        date: "2026-01-07",
      });
      actor = makeActor("admin", null, fx.ids.locL1);

      const html = await renderRoster({ week: fx.MONDAY });

      expect(html.includes(fx.employeeId(5))).toBeTrue();
      expect(text(rowOf(html, fx.employeeId(5)))).not.toContain("Daily");
      expect(rowOf(html, fx.employeeId(2))).toContain("Daily");
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

const RULES_SNAPSHOT = {
  c1: { value: 6, source: "default" },
  c2: { value: 20, source: "default" },
  c3: { value: false, source: "default" },
  c4: { value: false, source: "default" },
  c5: { value: 6, source: "default" },
  c6: { value: 1, source: "default" },
  c7: { value: false, source: "default" },
};

// The discard action writes an audit row whose actor is an FK to the auth
// user table, so the stub admin needs a real user row behind it.
async function seedAdmin(locationId: string) {
  const admin = makeActor("admin", null, locationId);
  await db
    .insert(user)
    .values({ id: admin.id, name: admin.name, email: admin.email });
  return {
    admin,
    async cleanup() {
      await db.delete(auditLog).where(eq(auditLog.actorId, admin.id));
      await db.delete(user).where(eq(user.id, admin.id));
    },
  };
}

async function insertDraft(
  fx: Awaited<ReturnType<typeof seedRosterFixtures>>,
  weekStart: string,
  version: number,
  generatedBy: string,
): Promise<string> {
  const id = randomUUID();
  await db.insert(rosterPlan).values({
    id,
    siteId: fx.ids.siteS,
    siteLocationId: fx.ids.locL1,
    kind: "weekly",
    weekStart,
    status: "draft",
    version,
    rulesSnapshot: RULES_SNAPSHOT,
    generatedBy,
  });
  return id;
}

describe("roster page: discarding a draft", () => {
  test("an admin on a draft week sees Discard draft; an ho does not", async () => {
    const fx = await seedRosterFixtures();
    try {
      actor = makeActor("admin", null, fx.ids.locL1);
      expect(text(await renderRoster({ week: fx.MONDAY }))).toContain(
        "Discard draft",
      );

      actor = makeActor("ho", fx.ids.siteS, null);
      const page = text(await renderRoster({ week: fx.MONDAY }));
      expect(page).toContain("Draft v1");
      expect(page).not.toContain("Discard draft");
    } finally {
      await fx.cleanup();
    }
  });

  test("discarding a week's first draft brings Generate back and keeps the request approved", async () => {
    const fx = await seedRosterFixtures();
    const seeded = await seedAdmin(fx.ids.locL1);
    let draftId: string | null = null;
    try {
      actor = seeded.admin;
      draftId = await insertDraft(fx, fx.APPROVED_MONDAY, 1, seeded.admin.id);
      const before = text(await renderRoster({ week: fx.APPROVED_MONDAY }));
      expect(before).toContain("Draft v1");
      expect(before).toContain("Discard draft");

      const { discardDraft } = await import("./actions");
      expect((await discardDraft(draftId)).ok).toBe(true);

      const html = await renderRoster({ week: fx.APPROVED_MONDAY });
      const page = text(html);
      expect(page).not.toContain("Draft v1");
      expect(page).not.toContain("Discard draft");
      expect(page).toContain("3 slots from 1 request");
      const trigger = html.indexOf("Generate draft");
      expect(trigger).toBeGreaterThan(-1);
      expect(html.slice(Math.max(0, trigger - 3000), trigger)).not.toContain(
        'disabled=""',
      );

      const requests = await db
        .select({ status: mpRequest.status })
        .from(mpRequest)
        .where(
          and(
            eq(mpRequest.siteLocationId, fx.ids.locL1),
            eq(mpRequest.weekStart, fx.APPROVED_MONDAY),
          ),
        );
      expect(requests.map((r) => r.status)).toEqual(["approved"]);
    } finally {
      if (draftId) await db.delete(rosterPlan).where(eq(rosterPlan.id, draftId));
      await seeded.cleanup();
      await fx.cleanup();
    }
  });

  test("a planId of a discarded draft renders the empty week", async () => {
    const fx = await seedRosterFixtures();
    const seeded = await seedAdmin(fx.ids.locL1);
    let draftId: string | null = null;
    try {
      actor = seeded.admin;
      draftId = await insertDraft(fx, fx.APPROVED_MONDAY, 1, seeded.admin.id);
      const { discardDraft } = await import("./actions");
      expect((await discardDraft(draftId)).ok).toBe(true);

      const page = text(
        await renderRoster({ week: fx.APPROVED_MONDAY, planId: draftId }),
      );
      expect(page).toContain("No plan for this week");
      expect(page).toContain(
        "No roster plan for this week yet. Generate a draft once a request is approved.",
      );
    } finally {
      if (draftId) await db.delete(rosterPlan).where(eq(rosterPlan.id, draftId));
      await seeded.cleanup();
      await fx.cleanup();
    }
  });

  test("discarding a revision draft falls back to the published version", async () => {
    const fx = await seedRosterFixtures();
    const seeded = await seedAdmin(fx.ids.locL1);
    let draftId: string | null = null;
    try {
      actor = seeded.admin;
      draftId = await insertDraft(fx, fx.LATE_MONDAY, 2, seeded.admin.id);
      expect(text(await renderRoster({ week: fx.LATE_MONDAY }))).toContain(
        "Draft v2",
      );

      const { discardDraft } = await import("./actions");
      expect((await discardDraft(draftId)).ok).toBe(true);

      const page = text(await renderRoster({ week: fx.LATE_MONDAY }));
      expect(page).toContain("Published v1");
      expect(page).toContain("Revise plan");
      expect(page).not.toContain("Draft v2");
      expect(page).not.toContain("Discard draft");
    } finally {
      if (draftId) await db.delete(rosterPlan).where(eq(rosterPlan.id, draftId));
      await seeded.cleanup();
      await fx.cleanup();
    }
  });
});
