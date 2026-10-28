import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "./db";
import {
  latestPublishedWeeklyPlan,
  loadAreaRequirements,
  loadPlanWithRows,
  loadDailyRequirements,
  loadPriorAssignments,
  loadRequirementsForWeek,
  loadShiftLabels,
  loadShiftOrder,
  loadWorkerProfiles,
} from "./roster-data";
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
  worker,
  workerPosition,
  workArea,
  workAreaPosition,
} from "../drizzle/schema";

// Loader contract pins (roster-engine task 5): shift order by orderIndex,
// live-area requirement sets, capability-derived worker pairs, weekly
// requirement lines from approved and fulfilled requests anchored exactly on
// the week, open daily requirement lines, prior assignments from published plans only, and the
// plan-with-rows bundle. Fixtures prefixed t-roster- and cleaned up
// FK-safely after the run; asserts are presence/exclusion, never counts.

// Anchors: 2026-01-05 is a Monday; 01-06 Tue; 01-12 next Monday.
const MON = "2026-01-05";
const TUE = "2026-01-06";
const NEXT_MON = "2026-01-12";

let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdUserIds: string[] = [];
const createdPositionIds: string[] = [];
const createdWorkAreaIds: string[] = [];
const createdShiftIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdRequestIds: string[] = [];
const createdRequestLineIds: string[] = [];
const createdPlanIds: string[] = [];
const createdAssignmentIds: string[] = [];

interface BaseFixture {
  siteId: string;
  locationId: string;
  adminId: string;
}

async function createBase(run: string, tag: string): Promise<BaseFixture> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  const locationId = randomUUID();
  createdLocationIds.push(locationId);
  const adminId = randomUUID();
  createdUserIds.push(adminId);
  await db.insert(site).values({ id: siteId, name: `t-roster-${run}-site-${tag}` });
  await db.insert(siteLocation).values({
    id: locationId,
    siteId,
    name: `t-roster-${run}-loc-${tag}`,
  });
  await db.insert(user).values({
    id: adminId,
    name: `t-roster-${run}-admin`,
    email: `t-roster-${run}-admin-${adminId}@shiftly.test`,
  });
  return { siteId, locationId, adminId };
}

async function createPosition(fx: BaseFixture, tag: string): Promise<string> {
  const id = randomUUID();
  createdPositionIds.push(id);
  await db.insert(position).values({
    id,
    siteId: fx.siteId,
    name: `t-roster-pos-${tag}-${id}`,
  });
  return id;
}

async function createWorkArea(
  fx: BaseFixture,
  tag: string,
  args: { deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  createdWorkAreaIds.push(id);
  await db.insert(workArea).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    name: `t-roster-area-${tag}-${id}`,
    ...(args.deleted ? { deletedAt: new Date() } : {}),
  });
  return id;
}

async function createShift(
  fx: BaseFixture,
  orderIndex: number,
  args: { inactive?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  createdShiftIds.push(id);
  await db.insert(shiftDefinition).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    label: `t-roster-shift-${orderIndex}-${id}`,
    orderIndex,
    startTime: "07:00",
    endTime: "15:00",
    ...(args.inactive ? { isActive: false } : {}),
    ...(args.deleted ? { deletedAt: new Date() } : {}),
  });
  return id;
}

async function createWorker(
  fx: BaseFixture,
  tag: string,
  args: { inactive?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  createdWorkerIds.push(id);
  await db.insert(worker).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    employeeId: `t-roster-emp-${tag}-${id}`,
    name: `t-roster-worker-${tag}-${id}`,
    ...(args.inactive ? { isActive: false } : {}),
    ...(args.deleted ? { deletedAt: new Date() } : {}),
  });
  return id;
}

async function giveWorkerPosition(
  fx: BaseFixture,
  workerId: string,
  positionId: string,
): Promise<void> {
  await db.insert(workerPosition).values({ workerId, positionId, siteId: fx.siteId });
}

async function requireAreaPosition(
  fx: BaseFixture,
  areaId: string,
  positionId: string,
): Promise<void> {
  await db
    .insert(workAreaPosition)
    .values({ workAreaId: areaId, positionId, siteId: fx.siteId, siteLocationId: fx.locationId });
}

interface RequestArgs {
  type?: "weekly" | "daily";
  status?: "open" | "approved" | "fulfilled" | "rejected";
  weekStart?: string | null;
  requestDate?: string | null;
}

async function createRequest(fx: BaseFixture, args: RequestArgs): Promise<string> {
  const id = randomUUID();
  createdRequestIds.push(id);
  const type = args.type ?? "weekly";
  await db.insert(mpRequest).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    type,
    status: args.status ?? "approved",
    ...(type === "weekly"
      ? { weekStart: args.weekStart ?? MON, requestDate: null }
      : { requestDate: args.requestDate ?? TUE, weekStart: null }),
    createdBy: fx.adminId,
  });
  return id;
}

async function addRequestLine(
  fx: BaseFixture,
  requestId: string,
  args: {
    workAreaId: string;
    shiftDefinitionId: string;
    date: string;
    headcount?: number;
    positionId?: string;
  },
): Promise<string> {
  const id = randomUUID();
  createdRequestLineIds.push(id);
  // A line demands one exact position (#135): default to a freshly created
  // position, pivoted onto the area; pass positionId to reuse one.
  const positionId = args.positionId ?? randomUUID();
  if (!args.positionId) {
    createdPositionIds.push(positionId);
    await db.insert(position).values({
      id: positionId,
      siteId: fx.siteId,
      name: `t-roster-pos-auto-${positionId}`,
    });
  }
  await db
    .insert(workAreaPosition)
    .values({ workAreaId: args.workAreaId, positionId, siteId: fx.siteId, siteLocationId: fx.locationId })
    .onConflictDoNothing();
  await db.insert(mpRequestLine).values({
    id,
    requestId,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    workAreaId: args.workAreaId,
    shiftDefinitionId: args.shiftDefinitionId,
    positionId,
    date: args.date,
    headcount: args.headcount ?? 2,
  });
  return positionId;
}

interface PlanArgs {
  kind?: "weekly" | "daily";
  weekStart?: string | null;
  requestDate?: string | null;
  status?: "draft" | "published";
  version?: number;
}

async function createPlan(
  fx: BaseFixture,
  args: PlanArgs,
): Promise<string> {
  const id = randomUUID();
  createdPlanIds.push(id);
  const kind = args.kind ?? "weekly";
  await db.insert(rosterPlan).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    kind,
    version: args.version ?? 1,
    ...(kind === "weekly"
      ? { weekStart: args.weekStart ?? MON, requestDate: null }
      : { requestDate: args.requestDate ?? TUE, weekStart: null }),
    ...(args.status ? { status: args.status } : {}),
    rulesSnapshot: {},
  });
  return id;
}

async function addPlanAssignment(
  fx: BaseFixture,
  planId: string,
  args: { workerId: string; workAreaId: string; shiftDefinitionId: string; date: string },
): Promise<void> {
  const id = randomUUID();
  createdAssignmentIds.push(id);
  await db.insert(rosterAssignment).values({
    id,
    planId,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    workerId: args.workerId,
    workAreaId: args.workAreaId,
    shiftDefinitionId: args.shiftDefinitionId,
    date: args.date,
  });
}

afterAll(async () => {
  if (createdAssignmentIds.length > 0) {
    await db.delete(rosterAssignment).where(inArray(rosterAssignment.id, createdAssignmentIds));
  }
  if (createdPlanIds.length > 0) {
    await db.delete(rosterPlan).where(inArray(rosterPlan.id, createdPlanIds));
  }
  if (createdRequestLineIds.length > 0) {
    await db.delete(mpRequestLine).where(inArray(mpRequestLine.id, createdRequestLineIds));
  }
  if (createdRequestIds.length > 0) {
    await db.delete(mpRequest).where(inArray(mpRequest.id, createdRequestIds));
  }
  // Pivots first: their FKs RESTRICT to the worker / work_area rows.
  if (createdWorkerIds.length > 0) {
    await db.delete(workerPosition).where(inArray(workerPosition.workerId, createdWorkerIds));
  }
  if (createdWorkAreaIds.length > 0) {
    await db.delete(workAreaPosition).where(inArray(workAreaPosition.workAreaId, createdWorkAreaIds));
  }
  if (createdWorkerIds.length > 0) {
    await db.delete(worker).where(inArray(worker.id, createdWorkerIds));
  }
  if (createdShiftIds.length > 0) {
    await db.delete(shiftDefinition).where(inArray(shiftDefinition.id, createdShiftIds));
  }
  if (createdWorkAreaIds.length > 0) {
    await db.delete(workArea).where(inArray(workArea.id, createdWorkAreaIds));
  }
  if (createdPositionIds.length > 0) {
    await db.delete(position).where(inArray(position.id, createdPositionIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
  }
  if (createdLocationIds.length > 0) {
    await db.delete(siteLocation).where(inArray(siteLocation.id, createdLocationIds));
  }
  if (createdSiteIds.length > 0) {
    await db.delete(site).where(inArray(site.id, createdSiteIds));
  }
});

describe("loadShiftOrder", () => {
  test("returns ids by orderIndex asc, skipping inactive and deleted definitions", async () => {
    const fx = await createBase(`t${nextSeq()}`, "order");
    const third = await createShift(fx, 3);
    const first = await createShift(fx, 1);
    const second = await createShift(fx, 2);
    const inactive = await createShift(fx, 4, { inactive: true });
    const deleted = await createShift(fx, 5, { deleted: true });

    const order = await loadShiftOrder(fx.locationId);

    expect(order).toEqual([first, second, third]);
    expect(order).not.toContain(inactive);
    expect(order).not.toContain(deleted);
  });

  test("other locations' shift definitions are excluded", async () => {
    const fx = await createBase(`t${nextSeq()}`, "order-own");
    const foreign = await createBase(`t${nextSeq()}`, "order-foreign");
    const own = await createShift(fx, 1);
    await createShift(foreign, 1);

    expect(await loadShiftOrder(fx.locationId)).toEqual([own]);
  });
});

describe("loadShiftLabels", () => {
  const labelOf = async (id: string) =>
    (await db.select({ label: shiftDefinition.label }).from(shiftDefinition).where(eq(shiftDefinition.id, id)))[0]
      .label;

  test("maps id to label for active and inactive live shifts, omitting deleted ones", async () => {
    const fx = await createBase(`t${nextSeq()}`, "labels");
    const active = await createShift(fx, 1);
    const inactive = await createShift(fx, 2, { inactive: true });
    const deleted = await createShift(fx, 3, { deleted: true });

    const labels = await loadShiftLabels(fx.locationId);

    expect(labels[active]).toBe(await labelOf(active));
    expect(labels[inactive]).toBe(await labelOf(inactive));
    expect(labels).not.toHaveProperty(deleted);
  });

  test("other locations' shift definitions are excluded", async () => {
    const fx = await createBase(`t${nextSeq()}`, "labels-own");
    const foreign = await createBase(`t${nextSeq()}`, "labels-foreign");
    const own = await createShift(fx, 1);
    const other = await createShift(foreign, 1);

    const labels = await loadShiftLabels(fx.locationId);

    expect(Object.keys(labels)).toEqual([own]);
    expect(labels).not.toHaveProperty(other);
  });
});

describe("loadAreaRequirements", () => {
  test("every live area is a key; areas without positions get []; deleted areas are absent", async () => {
    const fx = await createBase(`t${nextSeq()}`, "req");
    const posA = await createPosition(fx, "pa");
    const posB = await createPosition(fx, "pb");
    const withReqs = await createWorkArea(fx, "reqs");
    const bare = await createWorkArea(fx, "bare");
    const deletedArea = await createWorkArea(fx, "dead", { deleted: true });
    await requireAreaPosition(fx, withReqs, posA);
    await requireAreaPosition(fx, withReqs, posB);
    await requireAreaPosition(fx, deletedArea, posA);

    const reqs = await loadAreaRequirements(fx.locationId);

    expect(Object.keys(reqs).sort()).toEqual([bare, withReqs].sort());
    expect(reqs[withReqs].sort()).toEqual([posA, posB].sort());
    expect(reqs[bare]).toEqual([]);
  });

  test("another location's areas never leak in", async () => {
    const fx = await createBase(`t${nextSeq()}`, "req-own");
    const foreign = await createBase(`t${nextSeq()}`, "req-foreign");
    const ownArea = await createWorkArea(fx, "own");
    await createWorkArea(foreign, "foreign");
    const pos = await createPosition(fx, "own-pos");
    await requireAreaPosition(fx, ownArea, pos);

    const reqs = await loadAreaRequirements(fx.locationId);
    expect(Object.keys(reqs)).toEqual([ownArea]);
  });
});

describe("loadWorkerProfiles", () => {
  test("one pair per (live active worker, eligible area); inactive and deleted workers excluded", async () => {
    const fx = await createBase(`t${nextSeq()}`, "pairs");
    const posWelder = await createPosition(fx, "welder");
    const posClean = await createPosition(fx, "clean");
    const areaA = await createWorkArea(fx, "a");
    const areaB = await createWorkArea(fx, "b");
    const areaEmpty = await createWorkArea(fx, "e");
    await requireAreaPosition(fx, areaA, posWelder);
    await requireAreaPosition(fx, areaB, posClean);

    const dual = await createWorker(fx, "dual");
    await giveWorkerPosition(fx, dual, posWelder);
    await giveWorkerPosition(fx, dual, posClean);
    const inactive = await createWorker(fx, "off", { inactive: true });
    await giveWorkerPosition(fx, inactive, posWelder);
    const deleted = await createWorker(fx, "gone", { deleted: true });
    await giveWorkerPosition(fx, deleted, posClean);

    const profiles = await loadWorkerProfiles(fx.locationId);
    const pairs = profiles.map((p) => `${p.id}:${p.workAreaId}`).sort();

    // Dual worker pairs with A and B (C7 intersection) AND the empty area
    // (empty requirement = eligible per the ruling); inactive/deleted workers nowhere.
    expect(pairs).toEqual(
      [`${dual}:${areaA}`, `${dual}:${areaB}`, `${dual}:${areaEmpty}`].sort(),
    );
    expect(profiles[0].employeeId).toBe(`t-roster-emp-dual-${dual}`);
    expect([...profiles[0].positionIds].sort()).toEqual([posClean, posWelder].sort());
  });

  test("a worker qualifying for no live area is absent; the optional filter narrows to one area", async () => {
    const fx = await createBase(`t${nextSeq()}`, "narrow");
    const posWelder = await createPosition(fx, "welder");
    const posChef = await createPosition(fx, "chef");
    const areaA = await createWorkArea(fx, "a");
    const areaB = await createWorkArea(fx, "b");
    await requireAreaPosition(fx, areaA, posWelder);
    await requireAreaPosition(fx, areaB, posChef);

    const welder = await createWorker(fx, "welder");
    await giveWorkerPosition(fx, welder, posWelder);

    // Unfiltered: only areaA pairs (welder is no chef).
    expect((await loadWorkerProfiles(fx.locationId)).map((p) => `${p.id}:${p.workAreaId}`))
      .toEqual([`${welder}:${areaA}`]);
    // Filtered: areaB's pool is empty; areaA's pair survives.
    expect(await loadWorkerProfiles(fx.locationId, areaB)).toEqual([]);
    const narrowed = await loadWorkerProfiles(fx.locationId, areaA);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]).toEqual({
      id: welder,
      employeeId: `t-roster-emp-welder-${welder}`,
      workAreaId: areaA,
      positionIds: [posWelder],
    });
  });
});

describe("loadRequirementsForWeek", () => {
  test("includes approved weekly lines anchored exactly on the week", async () => {
    const fx = await createBase(`t${nextSeq()}`, "week-ok");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createShift(fx, 2);
    const approved = await createRequest(fx, { status: "approved", weekStart: MON });
    const pos = await addRequestLine(fx, approved, { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 3 });

    const expected = [{ workAreaId: area, shiftDefId: shift, positionId: pos, date: MON, headcount: 3 }];
    // approved is confirmed demand.
    expect(await loadRequirementsForWeek(fx.locationId, MON)).toEqual(expected);
  });

  test("loadRequirementsForWeek returns approved and fulfilled lines and excludes open and rejected", async () => {
    const fx = await createBase(`t${nextSeq()}`, "week-excl");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const approved = await createRequest(fx, { status: "approved", weekStart: MON });
    const approvedPos = await addRequestLine(fx, approved, { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 2 });
    const fulfilled = await createRequest(fx, { status: "fulfilled", weekStart: MON });
    const fulfilledPos = await addRequestLine(fx, fulfilled, { workAreaId: area, shiftDefinitionId: shift, date: TUE, headcount: 4 });
    const rejected = await createRequest(fx, { status: "rejected", weekStart: MON });
    await addRequestLine(fx, rejected, { workAreaId: area, shiftDefinitionId: shift, date: MON });
    // Open holds a slot, so it sits on a different week anchor than the approved one.
    const open = await createRequest(fx, { status: "open", weekStart: NEXT_MON });
    await addRequestLine(fx, open, { workAreaId: area, shiftDefinitionId: shift, date: NEXT_MON });

    const lines = await loadRequirementsForWeek(fx.locationId, MON);

    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual({ workAreaId: area, shiftDefId: shift, positionId: approvedPos, date: MON, headcount: 2 });
    expect(lines).toContainEqual({ workAreaId: area, shiftDefId: shift, positionId: fulfilledPos, date: TUE, headcount: 4 });
    expect(await loadRequirementsForWeek(fx.locationId, NEXT_MON)).toEqual([]);
  });

  test("other weeks and daily-type requests contribute nothing to the week", async () => {
    const fx = await createBase(`t${nextSeq()}`, "week-other");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const otherWeek = await createRequest(fx, { status: "approved", weekStart: NEXT_MON });
    await addRequestLine(fx, otherWeek, { workAreaId: area, shiftDefinitionId: shift, date: NEXT_MON });
    const daily = await createRequest(fx, { type: "daily", status: "approved", requestDate: TUE });
    await addRequestLine(fx, daily, { workAreaId: area, shiftDefinitionId: shift, date: TUE });

    expect(await loadRequirementsForWeek(fx.locationId, MON)).toEqual([]);
  });

  test("two requests of one week (one fulfilled, one approved) both contribute their lines, including identical area/shift/position/date lines, unmerged", async () => {
    const fx = await createBase(`t${nextSeq()}`, "week-two");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const fulfilled = await createRequest(fx, { status: "fulfilled", weekStart: MON });
    const pos = await addRequestLine(fx, fulfilled, { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 2 });
    const approved = await createRequest(fx, { status: "approved", weekStart: MON });
    await addRequestLine(fx, approved, { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 3, positionId: pos });
    await addRequestLine(fx, approved, { workAreaId: area, shiftDefinitionId: shift, date: TUE, headcount: 1, positionId: pos });

    const lines = await loadRequirementsForWeek(fx.locationId, MON);

    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.date === MON).map((l) => l.headcount).sort()).toEqual([2, 3]);
    expect(lines.filter((l) => l.date === TUE)).toEqual([
      { workAreaId: area, shiftDefId: shift, positionId: pos, date: TUE, headcount: 1 },
    ]);
  });
});

describe("loadDailyRequirements", () => {
  test("loadDailyRequirements returns only open daily lines inside the range and carries requestId", async () => {
    const fx = await createBase(`t${nextSeq()}`, "daily-open");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const inRange = await createRequest(fx, { type: "daily", status: "open", requestDate: TUE });
    const pos = await addRequestLine(fx, inRange, { workAreaId: area, shiftDefinitionId: shift, date: TUE, headcount: 5 });
    const outOfRange = await createRequest(fx, { type: "daily", status: "open", requestDate: "2026-02-10" });
    await addRequestLine(fx, outOfRange, { workAreaId: area, shiftDefinitionId: shift, date: "2026-02-10" });
    // A weekly request never counts as a daily slot.
    const weekly = await createRequest(fx, { type: "weekly", status: "open", weekStart: MON });
    await addRequestLine(fx, weekly, { workAreaId: area, shiftDefinitionId: shift, date: TUE });

    const lines = await loadDailyRequirements(fx.locationId, MON, NEXT_MON);

    expect(lines).toEqual([
      { requestId: inRange, workAreaId: area, shiftDefId: shift, positionId: pos, date: TUE, headcount: 5 },
    ]);
  });

  test("loadDailyRequirements ignores fulfilled daily requests", async () => {
    const fx = await createBase(`t${nextSeq()}`, "daily-done");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const fulfilled = await createRequest(fx, { type: "daily", status: "fulfilled", requestDate: TUE });
    await addRequestLine(fx, fulfilled, { workAreaId: area, shiftDefinitionId: shift, date: TUE });
    const rejected = await createRequest(fx, { type: "daily", status: "rejected", requestDate: TUE });
    await addRequestLine(fx, rejected, { workAreaId: area, shiftDefinitionId: shift, date: TUE });

    expect(await loadDailyRequirements(fx.locationId, MON, NEXT_MON)).toEqual([]);
  });

  test("other locations' daily requests never leak in", async () => {
    const mine = await createBase(`t${nextSeq()}`, "daily-mine");
    const theirs = await createBase(`t${nextSeq()}`, "daily-theirs");
    const area = await createWorkArea(theirs, "a");
    const shift = await createShift(theirs, 1);
    const req = await createRequest(theirs, { type: "daily", status: "open", requestDate: TUE });
    await addRequestLine(theirs, req, { workAreaId: area, shiftDefinitionId: shift, date: TUE });

    expect(await loadDailyRequirements(mine.locationId, MON, NEXT_MON)).toEqual([]);
  });
});

describe("loadPriorAssignments", () => {
  test("engine shape; published plans only; strict date < beforeDate; other locations excluded", async () => {
    const fx = await createBase(`t${nextSeq()}`, "prior");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const workerId = await createWorker(fx, "w");
    const args = { workerId, workAreaId: area, shiftDefinitionId: shift };

    // Published rows: one before the cutoff, one ON the cutoff (strict <
    // excludes it), one after.
    const published = await createPlan(fx, { status: "published", weekStart: MON });
    await addPlanAssignment(fx, published, { ...args, date: "2026-01-04" });
    await addPlanAssignment(fx, published, { ...args, date: MON });
    await addPlanAssignment(fx, published, { ...args, date: TUE });
    // Draft plan row dated BEFORE the cutoff — drafts never enter history.
    const draft = await createPlan(fx, { status: "draft", weekStart: NEXT_MON });
    await addPlanAssignment(fx, draft, { ...args, date: MON });

    const prior = await loadPriorAssignments(fx.locationId, TUE);

    expect(prior).toEqual([
      { workerId, date: "2026-01-04", shiftDefId: shift, workAreaId: area },
      { workerId, date: MON, shiftDefId: shift, workAreaId: area },
    ]);
  });

  test("other locations' published plans do not leak in", async () => {
    const fx = await createBase(`t${nextSeq()}`, "prior-own");
    const foreign = await createBase(`t${nextSeq()}`, "prior-foreign");
    const area = await createWorkArea(fx, "a");
    const foreignArea = await createWorkArea(foreign, "b");
    const shift = await createShift(fx, 1);
    const workerId = await createWorker(fx, "w");
    const published = await createPlan(fx, { status: "published", weekStart: MON });
    await addPlanAssignment(fx, published, { workerId, workAreaId: area, shiftDefinitionId: shift, date: MON });
    const foreignPlan = await createPlan(foreign, { status: "published", weekStart: MON });
    const foreignWorkerId = await createWorker(foreign, "fw");
    await addPlanAssignment(foreign, foreignPlan, {
      workerId: foreignWorkerId,
      workAreaId: foreignArea,
      shiftDefinitionId: await createShift(foreign, 1),
      date: MON,
    });

    expect(await loadPriorAssignments(fx.locationId, NEXT_MON)).toEqual([
      { workerId, date: MON, shiftDefId: shift, workAreaId: area },
    ]);
  });

  test("two published versions of the same week collapse to the LATEST version's rows only", async () => {
    const fx = await createBase(`t${nextSeq()}`, "prior-versions");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const w1 = await createWorker(fx, "w1");
    const w2 = await createWorker(fx, "w2");

    // v1 published (two worker-days), then a revise republishes v2 with one
    // row — v1 STAYS published (copy-on-edit keeps every version).
    const v1 = await createPlan(fx, { status: "published", weekStart: MON, version: 1 });
    await addPlanAssignment(fx, v1, { workerId: w1, workAreaId: area, shiftDefinitionId: shift, date: MON });
    await addPlanAssignment(fx, v1, { workerId: w2, workAreaId: area, shiftDefinitionId: shift, date: MON });
    const v2 = await createPlan(fx, { status: "published", weekStart: MON, version: 2 });
    await addPlanAssignment(fx, v2, { workerId: w1, workAreaId: area, shiftDefinitionId: shift, date: MON });

    // Only v2's single worker-day — a doubled worker-day would kick the
    // count rules and deadlock the generator's admission.
    expect(await loadPriorAssignments(fx.locationId, NEXT_MON)).toEqual([
      { workerId: w1, date: MON, shiftDefId: shift, workAreaId: area },
    ]);
  });

  test("daily plans of the same location never dedupe against each other (unique per date)", async () => {
    const fx = await createBase(`t${nextSeq()}`, "prior-daily");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const workerId = await createWorker(fx, "w");
    const daily = await createPlan(fx, { kind: "daily", status: "published", requestDate: TUE });
    await addPlanAssignment(fx, daily, { workerId, workAreaId: area, shiftDefinitionId: shift, date: TUE });

    expect(await loadPriorAssignments(fx.locationId, NEXT_MON)).toEqual([
      { workerId, date: TUE, shiftDefId: shift, workAreaId: area },
    ]);
  });
});

describe("latestPublishedWeeklyPlan", () => {
  test("picks the highest published version of the week; draft plans and other weeks do not count; null when none", async () => {
    const fx = await createBase(`t${nextSeq()}`, "latest-plan");
    const v1 = await createPlan(fx, { status: "published", weekStart: MON, version: 1 });
    const draft = await createPlan(fx, { status: "draft", weekStart: MON });
    const v2 = await createPlan(fx, { status: "published", weekStart: MON, version: 2 });
    await createPlan(fx, { status: "published", weekStart: NEXT_MON });

    const latest = await latestPublishedWeeklyPlan(fx.locationId, MON);
    expect(latest!.id).toBe(v2);
    expect(latest!.id).not.toBe(v1);
    expect(latest!.id).not.toBe(draft);

    expect(await latestPublishedWeeklyPlan(fx.locationId, "2026-01-19")).toBeNull();
  });
});

describe("loadPlanWithRows", () => {
  test("full plan row + engine-shaped assignments + raw rows; missing plan → null", async () => {
    const fx = await createBase(`t${nextSeq()}`, "bundle");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const workerId = await createWorker(fx, "w");
    const planId = await createPlan(fx, { status: "published", weekStart: MON });
    await addPlanAssignment(fx, planId, {
      workerId,
      workAreaId: area,
      shiftDefinitionId: shift,
      date: MON,
    });

    const bundle = await loadPlanWithRows(planId);

    expect(bundle).toBeTruthy();
    expect(bundle!.plan.id).toBe(planId);
    expect(bundle!.plan.status).toBe("published");
    expect(bundle!.plan.weekStart).toBe(MON);
    expect(bundle!.assignments).toEqual([
      { workerId, date: MON, shiftDefId: shift, workAreaId: area },
    ]);
    expect(bundle!.rows[0].date).toBe(MON);
    expect(bundle!.rows[0].workAreaId).toBe(area);
    expect(bundle!.rows[0].shiftDefinitionId).toBe(shift);

    expect(await loadPlanWithRows(randomUUID())).toBeNull();
  });
});
