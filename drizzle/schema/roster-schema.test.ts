import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { user } from "./auth-schema";
import { site, siteLocation } from "./site-schema";
import { workArea } from "./work-area-schema";
import { shiftDefinition } from "./shift-schema";
import { worker } from "./worker-schema";
import { mpRequest } from "./mp-request-schema";
import { rosterAssignment, rosterPlan } from "./roster-schema";

// DB-level pins for roster_plan / roster_assignment (roster spec §3.2–3.3):
// the exactly-one-anchor CHECK with the Monday dow rule, the one-live-draft
// weekly partial unique (publishing frees the slot), the status-less daily
// partial unique, the site weld on (site_location_id, site_id), the triple
// welds on assignments (worker pair, work_area, shift_definition), the
// (plan, worker, date) uniqueness, the plan→assignment cascade, and the
// RESTRICT on source_request. Fixtures prefixed t-roster- and cleaned up
// FK-safely after each run.

// Anchors: 2026-01-05 is a Monday, 2026-01-06 the following Tuesday.
const MONDAY = "2026-01-05";
const TUESDAY = "2026-01-06";

let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdUserIds: string[] = [];
const createdWorkAreaIds: string[] = [];
const createdShiftIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdRequestIds: string[] = [];
const createdPlanIds: string[] = [];
const createdAssignmentIds: string[] = [];

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-roster-${run}-site-${tag}-${siteId}`,
  });
  return siteId;
}

async function createLocation(
  run: string,
  tag: string,
  siteId: string,
): Promise<string> {
  const locationId = randomUUID();
  createdLocationIds.push(locationId);
  await db.insert(siteLocation).values({
    id: locationId,
    siteId,
    name: `t-roster-${run}-loc-${tag}-${locationId}`,
  });
  return locationId;
}

async function createUser(run: string): Promise<string> {
  const id = randomUUID();
  createdUserIds.push(id);
  await db.insert(user).values({
    id,
    name: `t-roster-${run}-admin`,
    email: `t-roster-${run}-${id}@shiftly.test`,
  });
  return id;
}

interface BaseFixture {
  siteId: string;
  locationId: string;
  adminId: string;
}

async function createBase(run: string, tag: string): Promise<BaseFixture> {
  const siteId = await createSite(run, tag);
  const locationId = await createLocation(run, tag, siteId);
  const adminId = await createUser(run);
  return { siteId, locationId, adminId };
}

async function createWorkArea(
  fx: BaseFixture,
  tag: string,
): Promise<string> {
  const id = randomUUID();
  createdWorkAreaIds.push(id);
  await db.insert(workArea).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    name: `t-roster-area-${tag}-${id}`,
  });
  return id;
}

async function createShift(fx: BaseFixture, orderIndex: number): Promise<string> {
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
  });
  return id;
}

async function createWorker(fx: BaseFixture, tag: string): Promise<string> {
  const id = randomUUID();
  createdWorkerIds.push(id);
  await db.insert(worker).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    employeeId: `t-roster-emp-${tag}-${id}`,
    name: `t-roster-worker-${tag}-${id}`,
  });
  return id;
}

interface PlanRowArgs {
  kind?: "weekly" | "daily";
  weekStart?: string | null;
  requestDate?: string | null;
  status?: "draft" | "published";
  version?: number;
  sourceRequestId?: string | null;
  generatedBy?: string | null;
}

async function insertPlan(
  fx: BaseFixture,
  args: PlanRowArgs,
  id = randomUUID(),
): Promise<string> {
  createdPlanIds.push(id);
  await db.insert(rosterPlan).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    kind: args.kind ?? "weekly",
    ...(args.weekStart !== undefined ? { weekStart: args.weekStart } : {}),
    ...(args.requestDate !== undefined
      ? { requestDate: args.requestDate }
      : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(args.version !== undefined ? { version: args.version } : {}),
    ...(args.sourceRequestId ? { sourceRequestId: args.sourceRequestId } : {}),
    ...(args.generatedBy ? { generatedBy: args.generatedBy } : {}),
    rulesSnapshot: { shifts: [], areas: {} },
  });
  return id;
}

interface AssignmentRowArgs {
  planId: string;
  workerId: string;
  workAreaId: string;
  shiftDefinitionId: string;
  date: string;
}

async function insertAssignment(
  fx: BaseFixture,
  args: AssignmentRowArgs,
  id = randomUUID(),
): Promise<string> {
  createdAssignmentIds.push(id);
  await db.insert(rosterAssignment).values({
    id,
    planId: args.planId,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    workerId: args.workerId,
    workAreaId: args.workAreaId,
    shiftDefinitionId: args.shiftDefinitionId,
    date: args.date,
  });
  return id;
}

afterAll(async () => {
  if (createdAssignmentIds.length > 0) {
    await db.delete(rosterAssignment).where(
      inArray(rosterAssignment.id, createdAssignmentIds),
    );
  }
  if (createdPlanIds.length > 0) {
    await db.delete(rosterPlan).where(inArray(rosterPlan.id, createdPlanIds));
  }
  if (createdWorkerIds.length > 0) {
    await db.delete(worker).where(inArray(worker.id, createdWorkerIds));
  }
  if (createdShiftIds.length > 0) {
    await db
      .delete(shiftDefinition)
      .where(inArray(shiftDefinition.id, createdShiftIds));
  }
  if (createdWorkAreaIds.length > 0) {
    await db.delete(workArea).where(inArray(workArea.id, createdWorkAreaIds));
  }
  if (createdRequestIds.length > 0) {
    await db
      .delete(mpRequest)
      .where(inArray(mpRequest.id, createdRequestIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
  }
  if (createdLocationIds.length > 0) {
    await db
      .delete(siteLocation)
      .where(inArray(siteLocation.id, createdLocationIds));
  }
  if (createdSiteIds.length > 0) {
    await db.delete(site).where(inArray(site.id, createdSiteIds));
  }
});

describe("roster_plan (roster spec §3.2)", () => {
  test("t-roster-anchor: weekly draft plan inserts with defaults", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "a");
    const planId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
      generatedBy: fx.adminId,
    });

    const [row] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.id, planId));
    expect(row).toBeTruthy();
    expect(row.siteId).toBe(fx.siteId);
    expect(row.siteLocationId).toBe(fx.locationId);
    expect(row.kind).toBe("weekly");
    expect(row.status).toBe("draft");
    expect(row.version).toBe(1);
    expect(row.weekStart).toBe(MONDAY);
    expect(row.requestDate).toBeNull();
    expect(row.generatedBy).toBe(fx.adminId);
    expect(row.publishedAt).toBeNull();
    expect(row.publishedBy).toBeNull();
    expect(row.sourceRequestId).toBeNull();
    expect(row.rulesSnapshot).toEqual({ shifts: [], areas: {} });
  });

  test("second draft weekly plan same location+week: rejected with 23505", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "b");
    await insertPlan(fx, { kind: "weekly", weekStart: MONDAY });
    const dupeId = randomUUID();

    let code: string | undefined;
    try {
      await insertPlan(fx, { kind: "weekly", weekStart: MONDAY }, dupeId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, dupeId)))
        .length,
    ).toBe(0);
  });

  test("after publishing, a new draft for the same week inserts fine", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "c");
    const publishedId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
      status: "published",
    });
    const newDraftId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
    });

    // Both coexist: the partial unique guards the mutable draft only, and
    // published versions keep every historical row.
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, publishedId)))
        .length,
    ).toBe(1);
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, newDraftId)))
        .length,
    ).toBe(1);
  });

  test("two published weekly plans for the same week coexist", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "d");
    const firstId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
      status: "published",
      version: 1,
    });
    const secondId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
      status: "published",
      version: 2,
    });

    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, firstId)))
        .length,
    ).toBe(1);
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, secondId)))
        .length,
    ).toBe(1);
  });

  test("second daily plan same location+date rejected even when the first is published", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "e");
    // No status filter on the daily partial unique — published history
    // still holds the slot for that date.
    await insertPlan(fx, {
      kind: "daily",
      requestDate: TUESDAY,
      status: "published",
    });
    const dupeId = randomUUID();

    let code: string | undefined;
    try {
      await insertPlan(fx, { kind: "daily", requestDate: TUESDAY }, dupeId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, dupeId)))
        .length,
    ).toBe(0);
  });

  test("daily and weekly plans anchor independently", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "f");
    const dailyId = await insertPlan(fx, {
      kind: "daily",
      requestDate: TUESDAY,
    });
    const weeklyId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
    });

    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, dailyId)))
        .length,
    ).toBe(1);
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, weeklyId)))
        .length,
    ).toBe(1);
  });

  test("CHECK rejects a weekly plan anchored on a Tuesday: 23514", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "g");
    const badId = randomUUID();

    let code: string | undefined;
    try {
      await insertPlan(fx, { kind: "weekly", weekStart: TUESDAY }, badId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, badId)))
        .length,
    ).toBe(0);
  });

  test("CHECK rejects a weekly plan carrying a request_date: 23514", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "h");
    const badId = randomUUID();

    let code: string | undefined;
    try {
      await insertPlan(
        fx,
        { kind: "weekly", weekStart: MONDAY, requestDate: TUESDAY },
        badId,
      );
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, badId)))
        .length,
    ).toBe(0);
  });

  test("CHECK rejects a daily plan carrying a week_start: 23514", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "i");
    const badId = randomUUID();

    let code: string | undefined;
    try {
      await insertPlan(
        fx,
        { kind: "daily", requestDate: TUESDAY, weekStart: MONDAY },
        badId,
      );
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, badId)))
        .length,
    ).toBe(0);
  });

  test("site weld: site_location_id from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const locationBId = await createLocation(run, "loc", siteBId);
    const badId = randomUUID();

    let code: string | undefined;
    try {
      createdPlanIds.push(badId);
      await db.insert(rosterPlan).values({
        id: badId,
        siteId: siteAId, // claiming site A
        siteLocationId: locationBId, // from site B — mismatch
        kind: "daily",
        requestDate: TUESDAY,
        rulesSnapshot: {},
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, badId)))
        .length,
    ).toBe(0);
  });

  test("source_request FK RESTRICT: deleting the referenced request fails with 23503", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "j");
    const requestId = randomUUID();
    createdRequestIds.push(requestId);
    await db.insert(mpRequest).values({
      id: requestId,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      type: "daily",
      requestDate: TUESDAY,
      createdBy: fx.adminId,
    });
    const planId = await insertPlan(fx, {
      kind: "daily",
      requestDate: TUESDAY,
      sourceRequestId: requestId,
    });

    let code: string | undefined;
    try {
      await db.delete(mpRequest).where(eq(mpRequest.id, requestId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    // ON DELETE RESTRICT raises PG's restrict_violation (23001) — the same
    // FK-referenced family as 23503 (both in REFERENCE_CODES).
    expect(code).toBe("23001");
    // The request (and its consuming plan) both survive.
    expect(
      (await db.select().from(mpRequest).where(eq(mpRequest.id, requestId)))
        .length,
    ).toBe(1);
    expect(
      (await db.select().from(rosterPlan).where(eq(rosterPlan.id, planId)))
        .length,
    ).toBe(1);
  });
});

describe("roster_assignment (roster spec §3.3)", () => {
  test("t-roster-anchor: assignment round-trips with defaults", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "k");
    const workAreaId = await createWorkArea(fx, "wa1");
    const shiftId = await createShift(fx, 1);
    const workerId = await createWorker(fx, "w1");
    const planId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
    });
    const assignmentId = await insertAssignment(fx, {
      planId,
      workerId,
      workAreaId,
      shiftDefinitionId: shiftId,
      date: MONDAY,
    });

    const [row] = await db
      .select()
      .from(rosterAssignment)
      .where(eq(rosterAssignment.id, assignmentId));
    expect(row).toBeTruthy();
    expect(row.planId).toBe(planId);
    expect(row.workerId).toBe(workerId);
    expect(row.workAreaId).toBe(workAreaId);
    expect(row.shiftDefinitionId).toBe(shiftId);
    expect(row.date).toBe(MONDAY);
    expect(row.siteId).toBe(fx.siteId);
    expect(row.siteLocationId).toBe(fx.locationId);
  });

  test("duplicate (plan, worker, date): rejected with 23505", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "l");
    const workAreaId = await createWorkArea(fx, "wa2");
    const shiftId = await createShift(fx, 1);
    const workerId = await createWorker(fx, "w2");
    const planId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
    });
    await insertAssignment(fx, {
      planId,
      workerId,
      workAreaId,
      shiftDefinitionId: shiftId,
      date: MONDAY,
    });

    const dupeId = randomUUID();
    createdAssignmentIds.push(dupeId);
    let code: string | undefined;
    try {
      // Same worker-day, different shift — still a violation.
      await db.insert(rosterAssignment).values({
        id: dupeId,
        planId,
        siteId: fx.siteId,
        siteLocationId: fx.locationId,
        workerId,
        workAreaId,
        shiftDefinitionId: await createShift(fx, 2),
        date: MONDAY,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db
        .select()
        .from(rosterAssignment)
        .where(eq(rosterAssignment.id, dupeId))).length,
    ).toBe(0);
  });

  test("weld: worker from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const locationAId = await createLocation(run, "locA", siteAId);
    const siteBId = await createSite(run, "b");
    const locationBId = await createLocation(run, "locB", siteBId);
    const adminId = await createUser(run);

    const fxOnB: BaseFixture = {
      siteId: siteBId,
      locationId: locationBId,
      adminId,
    };
    const foreignWorkerId = await createWorker(fxOnB, "foreign");

    const fxOnA: BaseFixture = {
      siteId: siteAId,
      locationId: locationAId,
      adminId,
    };
    const workAreaId = await createWorkArea(fxOnA, "wa3");
    const shiftId = await createShift(fxOnA, 1);
    const planId = await insertPlan(fxOnA, {
      kind: "weekly",
      weekStart: MONDAY,
    });
    const assignmentId = randomUUID();
    createdAssignmentIds.push(assignmentId);

    let code: string | undefined;
    try {
      await db.insert(rosterAssignment).values({
        id: assignmentId,
        planId,
        siteId: siteAId,
        siteLocationId: locationAId,
        workerId: foreignWorkerId, // site B worker
        workAreaId,
        shiftDefinitionId: shiftId,
        date: MONDAY,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db
        .select()
        .from(rosterAssignment)
        .where(eq(rosterAssignment.id, assignmentId))).length,
    ).toBe(0);
  });

  test("weld: work area from another location → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const locationAId = await createLocation(run, "locA", siteAId);
    const locationBId = await createLocation(run, "locB", siteAId);
    const adminId = await createUser(run);

    // Same site, different location — the triple weld rejects the
    // cross-location pairing, not just cross-site.
    const fxOnB: BaseFixture = {
      siteId: siteAId,
      locationId: locationBId,
      adminId,
    };
    const foreignWorkAreaId = await createWorkArea(fxOnB, "foreign-loc");

    const fxOnA: BaseFixture = {
      siteId: siteAId,
      locationId: locationAId,
      adminId,
    };
    const shiftId = await createShift(fxOnA, 1);
    const workerId = await createWorker(fxOnA, "w3");
    const planId = await insertPlan(fxOnA, {
      kind: "weekly",
      weekStart: MONDAY,
    });
    const assignmentId = randomUUID();
    createdAssignmentIds.push(assignmentId);

    let code: string | undefined;
    try {
      await db.insert(rosterAssignment).values({
        id: assignmentId,
        planId,
        siteId: siteAId,
        siteLocationId: locationAId,
        workerId,
        workAreaId: foreignWorkAreaId,
        shiftDefinitionId: shiftId,
        date: MONDAY,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db
        .select()
        .from(rosterAssignment)
        .where(eq(rosterAssignment.id, assignmentId))).length,
    ).toBe(0);
  });

  test("weld: shift definition from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const locationAId = await createLocation(run, "locA", siteAId);
    const siteBId = await createSite(run, "b");
    const locationBId = await createLocation(run, "locB", siteBId);
    const adminId = await createUser(run);

    const fxOnB: BaseFixture = {
      siteId: siteBId,
      locationId: locationBId,
      adminId,
    };
    const foreignShiftId = await createShift(fxOnB, 1);

    const fxOnA: BaseFixture = {
      siteId: siteAId,
      locationId: locationAId,
      adminId,
    };
    const workAreaId = await createWorkArea(fxOnA, "wa4");
    const workerId = await createWorker(fxOnA, "w4");
    const planId = await insertPlan(fxOnA, {
      kind: "weekly",
      weekStart: MONDAY,
    });
    const assignmentId = randomUUID();
    createdAssignmentIds.push(assignmentId);

    let code: string | undefined;
    try {
      await db.insert(rosterAssignment).values({
        id: assignmentId,
        planId,
        siteId: siteAId,
        siteLocationId: locationAId,
        workerId,
        workAreaId,
        shiftDefinitionId: foreignShiftId,
        date: MONDAY,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db
        .select()
        .from(rosterAssignment)
        .where(eq(rosterAssignment.id, assignmentId))).length,
    ).toBe(0);
  });

  test("deleting the plan cascades to its assignments", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "m");
    const workAreaId = await createWorkArea(fx, "wa5");
    const shiftId = await createShift(fx, 1);
    const workerId = await createWorker(fx, "w5");
    const doomedPlanId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: MONDAY,
    });
    const keptPlanId = await insertPlan(fx, {
      kind: "weekly",
      weekStart: "2026-01-12", // next Monday
    });
    const doomedAssignmentId = await insertAssignment(fx, {
      planId: doomedPlanId,
      workerId,
      workAreaId,
      shiftDefinitionId: shiftId,
      date: MONDAY,
    });
    const keptAssignmentId = await insertAssignment(fx, {
      planId: keptPlanId,
      workerId,
      workAreaId,
      shiftDefinitionId: shiftId,
      date: "2026-01-12",
    });

    // Drop the tracked id from the cleanup list — the cascade owns this row.
    const doomedIdx = createdAssignmentIds.indexOf(doomedAssignmentId);
    if (doomedIdx >= 0) createdAssignmentIds.splice(doomedIdx, 1);

    await db.delete(rosterPlan).where(eq(rosterPlan.id, doomedPlanId));
    const doomedPlanIdx = createdPlanIds.indexOf(doomedPlanId);
    if (doomedPlanIdx >= 0) createdPlanIds.splice(doomedPlanIdx, 1);

    expect(
      (await db
        .select()
        .from(rosterAssignment)
        .where(eq(rosterAssignment.id, doomedAssignmentId))).length,
    ).toBe(0);
    expect(
      (await db
        .select()
        .from(rosterAssignment)
        .where(eq(rosterAssignment.id, keptAssignmentId))).length,
    ).toBe(1);

    await db
      .delete(rosterAssignment)
      .where(eq(rosterAssignment.id, keptAssignmentId));
    const keptIdx = createdAssignmentIds.indexOf(keptAssignmentId);
    if (keptIdx >= 0) createdAssignmentIds.splice(keptIdx, 1);
  });
});
