import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  auditLog,
  mpRequest,
  mpRequestLine,
  position,
  rosterAssignment,
  rosterPlan,
  rosterRuleConfig,
  shiftDefinition,
  site,
  siteLocation,
  user,
  worker,
  workerPosition,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import { loadEffectiveRules } from "@/lib/rule-config";
import { loadPriorAssignments } from "@/lib/roster-data";
import type { SessionUser } from "@/types/session";

// Roster action pins (roster-engine task 6): the generate/revise/publish
// state machine over roster_plan + roster_assignment, with the audit trail
// in the SAME transaction as every write and the session re-checked inside
// every action. Fixtures t-roster-, cleaned FK-safely; asserts are
// presence/exclusion on this suite's own locations, never global counts.

// The actions resolve their actor through requireUser — swapped for a stub
// so the real server actions read against the test database. The mock
// swaps the WHOLE module across bun's single test process, so every export
// other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test — revalidatePath only records the
// paths it was asked for.
// Real exports kept (revalidateTag, updateTag, … stay available to suites that
// run after this one: module mocks are process-wide); only revalidatePath is
// replaced, since there is no Next request context under bun test.
const realNextCache = { ...(await import("next/cache")) };
let revalidated: string[] = [];
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

// A known Monday and the days after it.
const MON = "2026-01-05";
const TUE = "2026-01-06";
const NEXT_MON = "2026-01-12";

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: `t-roster-${randomUUID()}`,
    name: "T-Roster Actor",
    email: `t-roster-act-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// generated_by / published_by / audit actor are FKs to the auth user table
// (text PK), so a stub session still needs a real user row behind it.
async function seedUser(act: SessionUser) {
  createdUserIds.push(act.id);
  await db.insert(user).values({
    id: act.id,
    name: act.name,
    email: act.email,
  });
}

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
  name?: string,
): Promise<string> {
  const id = randomUUID();
  createdWorkAreaIds.push(id);
  await db.insert(workArea).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    name: name ?? `t-roster-area-${tag}-${id}`,
  });
  return id;
}

async function createShift(
  fx: BaseFixture,
  orderIndex: number,
  label?: string,
): Promise<string> {
  const id = randomUUID();
  createdShiftIds.push(id);
  await db.insert(shiftDefinition).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    label: label ?? `t-roster-shift-${orderIndex}-${id}`,
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

async function createRequest(
  fx: BaseFixture,
  args: { type: "weekly" | "daily"; status?: "open" | "approved" | "fulfilled" | "rejected"; weekStart?: string; requestDate?: string },
): Promise<string> {
  const id = randomUUID();
  createdRequestIds.push(id);
  await db.insert(mpRequest).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    type: args.type,
    status: args.status ?? (args.type === "daily" ? "open" : "approved"),
    ...(args.type === "weekly"
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
    // Defaults to a freshly created position, pivoted onto the area — a
    // line's demanded position must be one of the area's required
    // positions (#135).
    positionId?: string;
  },
): Promise<string> {
  const positionId = args.positionId ?? (await createPosition(fx, "auto"));
  // Idempotent pivot: several lines may demand the same (area, position).
  await db
    .insert(workAreaPosition)
    .values({
      workAreaId: args.workAreaId,
      positionId,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
    })
    .onConflictDoNothing();
  await db.insert(mpRequestLine).values({
    requestId,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    workAreaId: args.workAreaId,
    shiftDefinitionId: args.shiftDefinitionId,
    positionId,
    date: args.date,
    headcount: args.headcount ?? 1,
  });
  return positionId;
}

// Engine-shaped view of the plan's rows, the shape the actions hand to the
// validator; used for before/after compares in the regenerate-slice test.
async function readPlanRows(planId: string) {
  return db
    .select({
      workerId: rosterAssignment.workerId,
      workAreaId: rosterAssignment.workAreaId,
      shiftDefinitionId: rosterAssignment.shiftDefinitionId,
      date: rosterAssignment.date,
    })
    .from(rosterAssignment)
    .where(eq(rosterAssignment.planId, planId))
    .orderBy(rosterAssignment.date, rosterAssignment.workerId);
}

async function seedWeeklyDemand(fx: BaseFixture, lines: { workAreaId: string; shiftDefinitionId: string; date: string; headcount?: number; positionId?: string }[]) {
  const requestId = await createRequest(fx, { type: "weekly", weekStart: MON });
  for (const line of lines) await addRequestLine(fx, requestId, line);
  return requestId;
}

afterAll(async () => {
  // Audit pins the actor user; the action-created plans/assignments are
  // deleted by this suite's own locations (presence-scoped, not global).
  // One statement per table over every tracked location: the discard
  // describe tracks many locations, and a per-location loop of serial
  // deletes could outrun the default hook timeout and strand the rows.
  if (createdUserIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.actorId, createdUserIds));
  }
  if (createdRuleConfigIds.length > 0) {
    await db
      .delete(rosterRuleConfig)
      .where(inArray(rosterRuleConfig.id, createdRuleConfigIds));
  }
  if (createdLocationIds.length > 0) {
    // roster_assignment cascades from roster_plan, mp_request_line from
    // mp_request; plans go first, they RESTRICT their source request.
    await db
      .delete(rosterPlan)
      .where(inArray(rosterPlan.siteLocationId, createdLocationIds));
    await db
      .delete(mpRequest)
      .where(inArray(mpRequest.siteLocationId, createdLocationIds));
  }
  // Pivots first: they RESTRICT to worker / work_area rows.
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
}, 30_000);

// The trackers must be declared before createBase uses them (hoisting rule
// of bun's transpiler) — placed down here, the helpers above reference them
// through function scope after module evaluation.
const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdUserIds: string[] = [];
const createdPositionIds: string[] = [];
const createdWorkAreaIds: string[] = [];
const createdShiftIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdRequestIds: string[] = [];
const createdRuleConfigIds: string[] = [];

// Location-scoped rule override (retroactive-tightening tests); cleaned
// with the other fixtures.
async function tightenRule(
  fx: BaseFixture,
  ruleKey: "C1",
  intValue: number,
): Promise<void> {
  const id = randomUUID();
  createdRuleConfigIds.push(id);
  await db.insert(rosterRuleConfig).values({
    id,
    ruleKey,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    intValue,
  });
}

describe("roster actions: generateRoster", () => {
  test("admin generate happy: plan + rows + audit present, rulesSnapshot matches the resolved rules", async () => {
    const fx = await createBase(`t6-gh-${randomUUID()}`, "gen-happy");
    const pos = await createPosition(fx, "gh");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shift = await createShift(fx, 1);
    const w1 = await createWorker(fx, "w1");
    const w2 = await createWorker(fx, "w2");
    await giveWorkerPosition(fx, w1, pos);
    await giveWorkerPosition(fx, w2, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 2, positionId: pos },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster } = await import("./actions");
    const result = await generateRoster({ weekStart: MON, siteLocationId: fx.locationId });
    expect(result.ok).toBe(true);

    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(plan).toBeDefined();
    expect(plan.kind).toBe("weekly");
    expect(plan.weekStart).toBe(MON);
    expect(plan.status).toBe("draft");
    expect(plan.version).toBe(1);
    expect(plan.generatedBy).toBe(actor.id);
    expect(plan.publishedAt).toBeNull();
    expect(plan.rulesSnapshot).toEqual(await loadEffectiveRules(fx.locationId));

    const rows = await readPlanRows(plan.id);
    expect(rows.map((r) => r.workerId).sort()).toEqual([w1, w2].sort());
    expect(rows.every((r) => r.workAreaId === area && r.date === MON && r.shiftDefinitionId === shift)).toBe(true);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "roster.generate"), eq(auditLog.actorId, actor.id)));
    expect(audit).toBeDefined();
    expect(audit.siteId).toBe(fx.siteId);
    expect(audit.siteLocationId).toBe(fx.locationId);
    expect(audit.details).toEqual({ planId: plan.id, version: 1 });
  });

  test("generate without approved requirements for the week: refused, nothing written", async () => {
    const fx = await createBase(`t6-gn-${randomUUID()}`, "gen-noreq");
    await createWorkArea(fx, "a");
    await createShift(fx, 1);
    await createWorker(fx, "w");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster } = await import("./actions");
    const result = await generateRoster({ weekStart: MON, siteLocationId: fx.locationId });
    expect(result).toEqual({
      ok: false,
      message: "No approved requests cover this week.",
    });

    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(plans.length).toBe(0);
  });

  test("draft weekly plan already exists without workAreaId: refused twice-written nothing", async () => {
    const fx = await createBase(`t6-gd-${randomUUID()}`, "gen-dup");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    const second = await generateRoster({ weekStart: MON, siteLocationId: fx.locationId });
    expect(second).toEqual({ ok: false, message: "Draft already exists" });

    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(plans.length).toBe(1);
  });

  test("regenerate slice with workAreaId touches only its area; other areas' rows unchanged, same version", async () => {
    const fx = await createBase(`t6-gr-${randomUUID()}`, "gen-slice");
    const posA = await createPosition(fx, "pa");
    const posB = await createPosition(fx, "pb");
    const areaA = await createWorkArea(fx, "ma");
    const areaB = await createWorkArea(fx, "mb");
    await requireAreaPosition(fx, areaA, posA);
    await requireAreaPosition(fx, areaB, posB);
    const shiftA = await createShift(fx, 1);
    const shiftB = await createShift(fx, 2);
    const wa = await createWorker(fx, "wa");
    await giveWorkerPosition(fx, wa, posA);
    const wb = await createWorker(fx, "wb");
    await giveWorkerPosition(fx, wb, posB);
    await seedWeeklyDemand(fx, [
      { workAreaId: areaA, shiftDefinitionId: shiftA, date: MON, headcount: 1, positionId: posA },
      { workAreaId: areaB, shiftDefinitionId: shiftB, date: TUE, headcount: 1, positionId: posB },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    const before = await readPlanRows(plan.id);
    const beforeB = before.filter((r) => r.workAreaId === areaB);

    const regen = await generateRoster({
      weekStart: MON,
      workAreaId: areaA,
      siteLocationId: fx.locationId,
    });
    expect(regen.ok).toBe(true);

    const [planAfter] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(planAfter.id).toBe(plan.id);
    expect(planAfter.version).toBe(1);
    expect(planAfter.status).toBe("draft");

    const after = await readPlanRows(plan.id);
    const afterA = after.filter((r) => r.workAreaId === areaA);
    const afterB = after.filter((r) => r.workAreaId === areaB);

    // Area B untouched; area A still exactly one row (deterministic pick).
    expect(afterB).toEqual(beforeB);
    expect(afterA).toEqual([
      { workerId: wa, workAreaId: areaA, shiftDefinitionId: shiftA, date: MON },
    ]);
    expect(after.length).toBe(before.length);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "roster.regenerate"),
          eq(auditLog.actorId, actor.id),
        ),
      );
    expect(audit).toBeDefined();
    expect(audit.details).toEqual({ planId: plan.id, version: 1, workAreaId: areaA });
  });
});

describe("roster actions: publishRoster", () => {
  async function seedPublishFixture() {
    const fx = await createBase(`t6-p-${randomUUID()}`, "pub");
    const pos = await createPosition(fx, "p");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1, positionId: pos },
    ]);
    return { fx, area, shift, w };
  }

  test("publish blocked by a planted downshift: refusal carries the violation, plan stays draft", async () => {
    const fx = await createBase(`t6-p-${randomUUID()}`, "pub-down");
    const pos = await createPosition(fx, "pd");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shiftLow = await createShift(fx, 1, "Morning");
    const shiftHigh = await createShift(fx, 2, "Night");
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shiftHigh, date: MON, headcount: 1, positionId: pos },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));

    // Plant a TUE row for the same worker on a LOWER order index: MON 2 →
    // TUE 1 on consecutive days is a C3 downshift.
    await db.insert(rosterAssignment).values({
      planId: plan.id,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      workerId: w,
      workAreaId: area,
      shiftDefinitionId: shiftLow,
      date: TUE,
    });

    const result = await publishRoster(plan.id);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("downshift");
    expect(result.message).toContain(TUE);
    expect(result.message).toContain("from Night to Morning");
    expect(result.message).not.toContain(shiftHigh);
    expect(result.message).not.toContain(shiftLow);

    const [planAfter] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.id, plan.id));
    expect(planAfter.status).toBe("draft");
    expect(planAfter.publishedAt).toBeNull();
    expect(planAfter.publishedBy).toBeNull();
  });

  test("publish blocked by a C7 violation: refusal names the work area, not its id", async () => {
    const fx = await createBase(`t6-p-${randomUUID()}`, "pub-c7");
    const pos = await createPosition(fx, "req");
    const otherPos = await createPosition(fx, "other");
    const area = await createWorkArea(fx, "a", "Packing Line");
    await requireAreaPosition(fx, area, pos);
    // No requirement on this one: it keeps the worker's profile alive once
    // the worker loses the required position.
    await createWorkArea(fx, "open", "Open Floor");
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1, positionId: pos },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
      const { generateRoster, publishRoster } = await import("./actions");
      expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

      const [plan] = await db
        .select()
        .from(rosterPlan)
        .where(eq(rosterPlan.siteLocationId, fx.locationId));

      // The worker loses the required position AFTER the draft was generated.
      await db.delete(workerPosition).where(eq(workerPosition.workerId, w));
      await giveWorkerPosition(fx, w, otherPos);

      const result = await publishRoster(plan.id);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Assigned to Packing Line");
      expect(result.message).not.toContain(area);
    } finally {
      void fx;
    }
  });

  test("publish blocked by a worker deactivated after generation: refusal, not a silent publish", async () => {
    const { fx, w } = await seedPublishFixture();
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));

    // The worker dies AFTER the draft was generated.
    await db.update(worker).set({ isActive: false }).where(eq(worker.id, w));

    const result = await publishRoster(plan.id);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no longer active");

    const [planAfter] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.id, plan.id));
    expect(planAfter.status).toBe("draft");
    expect(planAfter.publishedBy).toBeNull();
  });

  test("publish happy: published fields + audit with zero violations", async () => {
    const { fx, w } = await seedPublishFixture();
    void w;
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));

    const result = await publishRoster(plan.id);
    expect(result.ok).toBe(true);

    const [planAfter] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.id, plan.id));
    expect(planAfter.status).toBe("published");
    expect(planAfter.publishedAt).not.toBeNull();
    expect(planAfter.publishedBy).toBe(actor.id);
    expect(planAfter.version).toBe(1);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "roster.publish"), eq(auditLog.actorId, actor.id)));
    expect(audit).toBeDefined();
    expect(audit.details).toEqual({
      planId: plan.id,
      version: 1,
      violationCount: 0,
      deficitCount: 0,
    });
  });
});

describe("planViolations", () => {
  test("a planted downshift is reported with the shift labels, not the ids", async () => {
    const fx = await createBase(`t6-pv-${randomUUID()}`, "pv");
    const area = await createWorkArea(fx, "a");
    const shiftLow = await createShift(fx, 1, "Morning");
    const shiftHigh = await createShift(fx, 2, "Night");
    const w = await createWorker(fx, "w");

    const { planViolations } = await import("@/lib/roster-plan-mutations");
    const violations = await planViolations(
      fx.locationId,
      await loadEffectiveRules(fx.locationId),
      [
        { workerId: w, date: MON, shiftDefId: shiftHigh, workAreaId: area },
        { workerId: w, date: TUE, shiftDefId: shiftLow, workAreaId: area },
      ],
    );

    const c3 = violations.find((v) => v.rule === "C3");
    expect(c3?.message).toContain("from Night to Morning");
    expect(c3?.message).not.toContain(shiftHigh);
  });

  test("a C7 violation names the work area, not its id", async () => {
    const fx = await createBase(`t6-pv7-${randomUUID()}`, "pv7");
    const pos = await createPosition(fx, "req");
    const otherPos = await createPosition(fx, "other");
    const area = await createWorkArea(fx, "a", "Packing Line");
    await requireAreaPosition(fx, area, pos);
    // An area with no requirement keeps the worker's profile alive (a profile
    // exists only for an area the worker is eligible for), so C7 can bite on
    // `area`.
    await createWorkArea(fx, "open", "Open Floor");
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, otherPos);

    const { planViolations } = await import("@/lib/roster-plan-mutations");
    const violations = await planViolations(
      fx.locationId,
      await loadEffectiveRules(fx.locationId),
      [{ workerId: w, date: MON, shiftDefId: shift, workAreaId: area }],
    );

    const c7 = violations.find((v) => v.rule === "C7");
    expect(c7?.message).toContain("Assigned to Packing Line on");
    expect(c7?.message).not.toContain(area);
  });

  // #180: setAssignment calls planViolations while holding a transaction's
  // connection. Rows only that transaction can see (uncommitted) prove the
  // loaders ran on its handle and not on a second pooled connection.
  test("loaders read through the transaction handle they are given", async () => {
    const fx = await createBase(`t6-pvtx-${randomUUID()}`, "pvtx");
    const w = await createWorker(fx, "w");
    const areaId = randomUUID();
    const lowId = randomUUID();
    const highId = randomUUID();
    const ROLLBACK = new Error("rollback the uncommitted fixtures");

    const { planViolations } = await import("@/lib/roster-plan-mutations");
    const rules = await loadEffectiveRules(fx.locationId);
    let violations: Awaited<ReturnType<typeof planViolations>> = [];
    try {
      await db.transaction(async (tx) => {
        await tx.insert(workArea).values({
          id: areaId,
          siteId: fx.siteId,
          siteLocationId: fx.locationId,
          name: "Tx Area",
        });
        await tx.insert(shiftDefinition).values([
          {
            id: lowId,
            siteId: fx.siteId,
            siteLocationId: fx.locationId,
            label: "Tx Morning",
            orderIndex: 1,
            startTime: "07:00",
            endTime: "15:00",
          },
          {
            id: highId,
            siteId: fx.siteId,
            siteLocationId: fx.locationId,
            label: "Tx Night",
            orderIndex: 2,
            startTime: "15:00",
            endTime: "23:00",
          },
        ]);
        violations = await planViolations(
          fx.locationId,
          rules,
          [
            { workerId: w, date: MON, shiftDefId: highId, workAreaId: areaId },
            { workerId: w, date: TUE, shiftDefId: lowId, workAreaId: areaId },
          ],
          tx,
        );
        throw ROLLBACK;
      });
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }

    const c3 = violations.find((v) => v.rule === "C3");
    expect(c3?.message).toContain("from Tx Night to Tx Morning");
    expect(violations.some((v) => v.message === "unknown shift")).toBe(false);
  });
});

describe("roster actions: setAssignment + ensureDraftVersion", () => {
  test("edit on a published plan creates a v2 draft; the published copy is untouched and the edit lands on v2", async () => {
    const fx = await createBase(`t6-sa-${randomUUID()}`, "set-a");
    const area = await createWorkArea(fx, "a");
    const shift1 = await createShift(fx, 1);
    const shift2 = await createShift(fx, 2);
    const w = await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift1, date: MON, headcount: 1 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, setAssignment } = await import("./actions");
    const { ensureDraftVersion } = await import("@/lib/roster-plan-mutations");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    const [v1] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    const v1RowsBefore = await readPlanRows(v1.id);
    await db.update(rosterPlan).set({ status: "published" }).where(eq(rosterPlan.id, v1.id));

    const result = await setAssignment({
      planId: v1.id,
      workerId: w,
      date: MON,
      workAreaId: area,
      shiftDefId: shift2,
    });
    expect(result.ok).toBe(true);
    expect(result.data?.violations).toEqual([]);

    // v1 published row untouched: status/rows byte-identical.
    const [v1After] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, v1.id));
    expect(v1After.status).toBe("published");
    expect(v1After.version).toBe(1);
    expect(await readPlanRows(v1.id)).toEqual(v1RowsBefore);

    // v2 draft exists with the copied row showing the EDIT.
    const [v2] = await db
      .select()
      .from(rosterPlan)
      .where(and(eq(rosterPlan.siteLocationId, fx.locationId), eq(rosterPlan.status, "draft")));
    expect(v2).toBeDefined();
    expect(v2.version).toBe(2);
    expect(v2.publishedAt).toBeNull();
    expect(v2.publishedBy).toBeNull();
    expect(await readPlanRows(v2.id)).toEqual([
      { workerId: w, workAreaId: area, shiftDefinitionId: shift2, date: MON },
    ]);

    const [reviseAudit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "roster.revise"), eq(auditLog.actorId, actor.id)));
    expect(reviseAudit).toBeDefined();
    expect(reviseAudit.details).toEqual({
      planId: v1.id,
      newPlanId: v2.id,
      version: 2,
    });

    // ensureDraftVersion on the already-draft v2 returns it unchanged.
    expect(await ensureDraftVersion(v2.id, actor.id)).toBe(v2.id);
  });

  test("copy-on-edit guard: the write path refuses a plan that turned published mid-edit", async () => {
    const fx = await createBase(`t6-sr1-${randomUUID()}`, "set-guard");
    const area = await createWorkArea(fx, "a");
    const shift1 = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift1, date: MON, headcount: 1 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster } = await import("./actions");
    const { applyAssignmentEdit } = await import("@/lib/roster-plan-mutations");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    const rowsBefore = await readPlanRows(plan.id);
    await db.update(rosterPlan).set({ status: "published" }).where(eq(rosterPlan.id, plan.id));

    // Unit-drive the WRITE half with the now-published plan id — the
    // state a publish wedged between ensureDraftVersion and the write
    // would present.
    const result = await applyAssignmentEdit(plan.id, {
      planId: plan.id,
      workerId: w,
      date: MON,
      workAreaId: area,
      shiftDefId: shift1,
    });
    expect(result).toEqual({
      ok: false,
      message: "Plan was published while editing, retry",
    });

    // Nothing landed: rows byte-identical, status untouched.
    expect(await readPlanRows(plan.id)).toEqual(rowsBefore);
    const [planAfter] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, plan.id));
    expect(planAfter.status).toBe("published");
    expect(planAfter.version).toBe(1);
  });
});

describe("roster actions: fillDailyRequest", () => {
  test("without a published weekly plan covering the date's week: refused", async () => {
    const fx = await createBase(`t6-dn-${randomUUID()}`, "daily-nopub");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    const requestId = await createRequest(fx, { type: "daily", requestDate: TUE });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { fillDailyRequest } = await import("./actions");
    const result = await fillDailyRequest({
      requestId,
      workAreaId: area,
      shiftDefId: shift,
      date: TUE,
      positionId: randomUUID(),
      workerId: w,
      siteLocationId: fx.locationId,
    });
    expect(result).toEqual({ ok: false, message: "Publish the weekly roster first" });

    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(plans.length).toBe(0);
  });

  test("daily fill happy: daily plan + assignment + audit over the published week", async () => {
    const fx = await createBase(`t6-dh-${randomUUID()}`, "daily-happy");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    // A higher-order shift keeps C4 (rest after the LAST shift) neutral in
    // this fixture — the fill's admission loop must be free to admit TUE.
    await createShift(fx, 2);
    const w = await createWorker(fx, "w");
    const pos = await createPosition(fx, "d");
    await requireAreaPosition(fx, area, pos);
    await giveWorkerPosition(fx, w, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    const requestId = await createRequest(fx, { type: "daily", requestDate: TUE });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster, fillDailyRequest } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [weeklyPlan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(weeklyPlan.id)).ok).toBe(true);

    const result = await fillDailyRequest({
      requestId,
      workAreaId: area,
      shiftDefId: shift,
      date: TUE,
      positionId: pos,
      workerId: w,
      siteLocationId: fx.locationId,
    });
    expect(result.ok).toBe(true);

    const [dailyPlan] = await db
      .select()
      .from(rosterPlan)
      .where(and(eq(rosterPlan.siteLocationId, fx.locationId), eq(rosterPlan.kind, "daily")));
    expect(dailyPlan).toBeDefined();
    expect(dailyPlan.requestDate).toBe(TUE);
    expect(dailyPlan.status).toBe("draft");
    expect(dailyPlan.sourceRequestId).toBe(requestId);

    const rows = await readPlanRows(dailyPlan.id);
    expect(rows).toEqual([
      { workerId: w, workAreaId: area, shiftDefinitionId: shift, date: TUE },
    ]);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "roster.daily_request.fill"),
          eq(auditLog.actorId, actor.id),
        ),
      );
    expect(audit).toBeDefined();
    expect(audit.details).toEqual({ requestId, workerId: w, date: TUE, positionId: pos });
  });

  test("double daily fill on the same date: friendly duplicate message", async () => {
    const fx = await createBase(`t6-dd-${randomUUID()}`, "daily-dup");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createShift(fx, 2);
    const w = await createWorker(fx, "w");
    const pos = await createPosition(fx, "dd");
    await requireAreaPosition(fx, area, pos);
    await giveWorkerPosition(fx, w, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    const requestId = await createRequest(fx, { type: "daily", requestDate: TUE });
    // Two heads demanded, so the first fill leaves the request open and the
    // repeat of the same worker reaches the duplicate guard.
    await addRequestLine(fx, requestId, {
      workAreaId: area,
      shiftDefinitionId: shift,
      date: TUE,
      headcount: 2,
      positionId: pos,
    });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster, fillDailyRequest } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [weeklyPlan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(weeklyPlan.id)).ok).toBe(true);

    const input = {
      requestId,
      workAreaId: area,
      shiftDefId: shift,
      date: TUE,
      positionId: pos,
      workerId: w,
      siteLocationId: fx.locationId,
    };
    expect((await fillDailyRequest(input)).ok).toBe(true);

    const second = await fillDailyRequest(input);
    expect(second.ok).toBe(false);
    expect(second.message).toContain("already");
    expect(second.message).not.toBe("Something went wrong. Please try again.");

    // Still exactly one daily plan and one assignment.
    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(and(eq(rosterPlan.siteLocationId, fx.locationId), eq(rosterPlan.kind, "daily")));
    expect(plans.length).toBe(1);
    const rows = await readPlanRows(plans[0].id);
    expect(rows.length).toBe(1);
  });

  test("fill with a position the worker does not hold: POSITION_MISMATCH, no assignment", async () => {
    const fx = await createBase(`t6-dm-${randomUUID()}`, "daily-mismatch");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createShift(fx, 2);
    const w = await createWorker(fx, "w");
    const pos = await createPosition(fx, "dm-held");
    await requireAreaPosition(fx, area, pos);
    await giveWorkerPosition(fx, w, pos);
    // The requested position is genuinely required by the area — the only
    // thing wrong is that this worker does not hold it.
    const otherPos = await createPosition(fx, "dm-other");
    await requireAreaPosition(fx, area, otherPos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    const requestId = await createRequest(fx, { type: "daily", requestDate: TUE });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster, fillDailyRequest } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [weeklyPlan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(weeklyPlan.id)).ok).toBe(true);

    const result = await fillDailyRequest({
      requestId,
      workAreaId: area,
      shiftDefId: shift,
      date: TUE,
      positionId: otherPos,
      workerId: w,
      siteLocationId: fx.locationId,
    });
    expect(result).toEqual({
      ok: false,
      message: "Worker does not hold the requested position",
    });

    // Nothing landed: no daily plan, therefore no assignment row.
    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(and(eq(rosterPlan.siteLocationId, fx.locationId), eq(rosterPlan.kind, "daily")));
    expect(plans.length).toBe(0);
  });

  // Shared setup for the fulfilment pins: a published week plus an admin
  // actor, with the daily request's demand on TUE. Returns what the fills need.
  async function setupDailyFulfilment(
    tag: string,
    opts: { headcount: number; workers: number; status?: "open" | "fulfilled" | "rejected" },
  ) {
    const fx = await createBase(`t5-${tag}-${randomUUID()}`, `daily-${tag}`);
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createShift(fx, 2);
    const pos = await createPosition(fx, tag);
    await requireAreaPosition(fx, area, pos);
    const workers: string[] = [];
    for (let i = 0; i < opts.workers; i++) {
      const w = await createWorker(fx, `w${i}`);
      await giveWorkerPosition(fx, w, pos);
      workers.push(w);
    }
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1, positionId: pos },
    ]);
    const requestId = await createRequest(fx, {
      type: "daily",
      status: opts.status,
      requestDate: TUE,
    });
    await addRequestLine(fx, requestId, {
      workAreaId: area,
      shiftDefinitionId: shift,
      date: TUE,
      headcount: opts.headcount,
      positionId: pos,
    });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [weeklyPlan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(weeklyPlan.id)).ok).toBe(true);

    const fillInput = (requestIdArg: string, workerId: string) => ({
      requestId: requestIdArg,
      workAreaId: area,
      shiftDefId: shift,
      date: TUE,
      positionId: pos,
      workerId,
      siteLocationId: fx.locationId,
    });
    return { fx, area, shift, pos, workers, requestId, fillInput };
  }

  async function requestStatus(id: string) {
    const [row] = await db.select({ status: mpRequest.status }).from(mpRequest).where(eq(mpRequest.id, id));
    return row.status;
  }

  // The weekly publish in the setup writes its own status_change rows for the
  // same actor, so the pins narrow to the request under test.
  async function statusAudits(requestId: string) {
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "mp_request.status_change"), eq(auditLog.actorId, actor.id)));
    return rows.filter((r) => (r.details as { requestId?: string }).requestId === requestId);
  }

  async function dailyAssignmentCount(locationId: string) {
    const rows = await db
      .select({ id: rosterAssignment.id })
      .from(rosterAssignment)
      .innerJoin(rosterPlan, eq(rosterAssignment.planId, rosterPlan.id))
      .where(and(eq(rosterPlan.siteLocationId, locationId), eq(rosterPlan.kind, "daily")));
    return rows.length;
  }

  test("filling one of two required heads leaves the daily request open", async () => {
    const s = await setupDailyFulfilment("part", { headcount: 2, workers: 2 });
    const { fillDailyRequest } = await import("./actions");
    const result = await fillDailyRequest(s.fillInput(s.requestId, s.workers[0]));
    expect(result.ok).toBe(true);
    expect(await requestStatus(s.requestId)).toBe("open");

    const audits = await statusAudits(s.requestId);
    expect(audits.length).toBe(0);
  });

  test("the fill that completes the headcount marks it fulfilled with an auto audit row", async () => {
    const s = await setupDailyFulfilment("full", { headcount: 2, workers: 2 });
    const { fillDailyRequest } = await import("./actions");
    expect((await fillDailyRequest(s.fillInput(s.requestId, s.workers[0]))).ok).toBe(true);
    expect((await fillDailyRequest(s.fillInput(s.requestId, s.workers[1]))).ok).toBe(true);
    expect(await requestStatus(s.requestId)).toBe("fulfilled");

    const audits = await statusAudits(s.requestId);
    expect(audits.length).toBe(1);
    expect(audits[0].siteId).toBe(s.fx.siteId);
    expect(audits[0].siteLocationId).toBe(s.fx.locationId);
    expect(audits[0].details).toEqual({
      requestId: s.requestId,
      type: "daily",
      oldValue: "open",
      newValue: "fulfilled",
      auto: true,
    });
  });

  test("a second same-slot daily request is not fulfilled by the first request's fills", async () => {
    const s = await setupDailyFulfilment("seq", { headcount: 2, workers: 4 });
    const { fillDailyRequest } = await import("./actions");
    expect((await fillDailyRequest(s.fillInput(s.requestId, s.workers[0]))).ok).toBe(true);
    expect((await fillDailyRequest(s.fillInput(s.requestId, s.workers[1]))).ok).toBe(true);
    expect(await requestStatus(s.requestId)).toBe("fulfilled");

    // The first request freed the date's slot: "more people needed today".
    const second = await createRequest(s.fx, { type: "daily", requestDate: TUE });
    await addRequestLine(s.fx, second, {
      workAreaId: s.area,
      shiftDefinitionId: s.shift,
      date: TUE,
      headcount: 2,
      positionId: s.pos,
    });

    expect((await fillDailyRequest(s.fillInput(second, s.workers[2]))).ok).toBe(true);
    expect(await requestStatus(second)).toBe("open");
    expect((await statusAudits(second)).length).toBe(0);

    expect((await fillDailyRequest(s.fillInput(second, s.workers[3]))).ok).toBe(true);
    expect(await requestStatus(second)).toBe("fulfilled");
    expect((await statusAudits(second)).length).toBe(1);
  });

  test("fill against a fulfilled daily request is refused with REQUEST_GONE and writes no assignment", async () => {
    const s = await setupDailyFulfilment("done", { headcount: 1, workers: 1, status: "fulfilled" });
    const { fillDailyRequest } = await import("./actions");
    const result = await fillDailyRequest(s.fillInput(s.requestId, s.workers[0]));
    expect(result).toEqual({ ok: false, message: "Daily request not found." });
    expect(await dailyAssignmentCount(s.fx.locationId)).toBe(0);
  });

  test("fill against a rejected request is refused", async () => {
    const s = await setupDailyFulfilment("rej", { headcount: 1, workers: 1, status: "rejected" });
    const { fillDailyRequest } = await import("./actions");
    const result = await fillDailyRequest(s.fillInput(s.requestId, s.workers[0]));
    expect(result).toEqual({ ok: false, message: "Daily request not found." });
    expect(await dailyAssignmentCount(s.fx.locationId)).toBe(0);
  });

  test("fill against a weekly request id is refused", async () => {
    const s = await setupDailyFulfilment("wk", { headcount: 1, workers: 1 });
    const weeklyOpen = await createRequest(s.fx, { type: "weekly", status: "open", weekStart: NEXT_MON });
    const { fillDailyRequest } = await import("./actions");
    const result = await fillDailyRequest(s.fillInput(weeklyOpen, s.workers[0]));
    expect(result).toEqual({ ok: false, message: "Daily request not found." });
    expect(await dailyAssignmentCount(s.fx.locationId)).toBe(0);
    expect(await requestStatus(weeklyOpen)).toBe("open");
  });

  test("fill against another location's request is refused", async () => {
    const s = await setupDailyFulfilment("loc", { headcount: 1, workers: 1 });
    const other = await createBase(`t5-oth-${randomUUID()}`, "daily-other");
    const foreign = await createRequest(other, { type: "daily", requestDate: TUE });
    const { fillDailyRequest } = await import("./actions");
    const result = await fillDailyRequest(s.fillInput(foreign, s.workers[0]));
    expect(result).toEqual({ ok: false, message: "Daily request not found." });
    expect(await dailyAssignmentCount(s.fx.locationId)).toBe(0);
    expect(await requestStatus(foreign)).toBe("open");
  });
});

// #179: a daily fill is validated over the whole week's daily rows, not just
// its own date's, so week rules see an earlier fill on a nearby day.
describe("roster actions: fillDailyRequest week context", () => {
  const WED = "2026-01-07";
  const THU = "2026-01-08";
  const FRI = "2026-01-09";

  // A published week (one weekly row for `anchor` on `weeklyShift`) plus two
  // open daily requests, so two fills can land on different days of it.
  async function seedPublishedWeek(args: {
    tag: string;
    shiftCount: number;
    weeklyShiftOrder: number;
    anchorDate: string;
    requestDates: string[];
  }) {
    const fx = await createBase(`t6-dw-${randomUUID()}`, args.tag);
    const pos = await createPosition(fx, args.tag);
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shifts: string[] = [];
    for (let i = 1; i <= args.shiftCount; i += 1) shifts.push(await createShift(fx, i));
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, pos);
    const other = await createWorker(fx, "other");
    await giveWorkerPosition(fx, other, pos);
    // The weekly row belongs to `other`: the worker under test starts the
    // week with no weekly shift, only the daily fills.
    await seedWeeklyDemand(fx, [
      {
        workAreaId: area,
        shiftDefinitionId: shifts[args.weeklyShiftOrder - 1],
        date: args.anchorDate,
        headcount: 1,
        positionId: pos,
      },
    ]);
    const requestIds: string[] = [];
    for (const date of args.requestDates) {
      requestIds.push(await createRequest(fx, { type: "daily", requestDate: date }));
    }
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [weeklyPlan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(weeklyPlan.id)).ok).toBe(true);

    const fill = async (
      i: number,
      date: string,
      shiftOrder: number,
      workerId = w,
    ) => {
      const { fillDailyRequest } = await import("./actions");
      return fillDailyRequest({
        requestId: requestIds[i],
        workAreaId: area,
        shiftDefId: shifts[shiftOrder - 1],
        date,
        positionId: pos,
        workerId,
        siteLocationId: fx.locationId,
      });
    };
    return { fx, w, other, fill };
  }

  test("C1: a fill that would be the worker's 2nd day (max 1) across two daily plans is refused", async () => {
    const { fx, w, fill } = await seedPublishedWeek({
      tag: "c1",
      shiftCount: 2,
      weeklyShiftOrder: 1,
      anchorDate: WED,
      requestDates: [MON, FRI],
    });
    // One day a week: the weekly row is `other`'s, so w's own days are the
    // daily fills on MON and FRI.
    await tightenRule(fx, "C1", 1);

    expect((await fill(0, MON, 1)).ok).toBe(true);
    const refused = await fill(1, FRI, 1);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("max is 1");

    const dailyRows = await db
      .select({ date: rosterAssignment.date })
      .from(rosterAssignment)
      .where(and(eq(rosterAssignment.workerId, w), eq(rosterAssignment.date, FRI)));
    expect(dailyRows.length).toBe(0);
  });

  test("C1: a worker with no earlier daily fill is still accepted on the same day", async () => {
    const { fx, other, fill } = await seedPublishedWeek({
      tag: "c1-ok",
      shiftCount: 2,
      weeklyShiftOrder: 1,
      anchorDate: WED,
      requestDates: [MON, FRI],
    });
    await tightenRule(fx, "C1", 2);

    // `other` works the weekly WED; MON is their 2nd day (max 2), accepted.
    expect((await fill(0, MON, 1, other)).ok).toBe(true);
  });

  test("C3: a downshift against the previous day's daily fill is refused", async () => {
    const { fill } = await seedPublishedWeek({
      tag: "c3",
      shiftCount: 3,
      weeklyShiftOrder: 1,
      anchorDate: MON,
      requestDates: [TUE, WED],
    });

    expect((await fill(0, TUE, 2)).ok).toBe(true);
    const refused = await fill(1, WED, 1);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("downshift");
  });

  test("C4: working the day after a last-shift daily fill is refused", async () => {
    const { fill } = await seedPublishedWeek({
      tag: "c4",
      shiftCount: 2,
      weeklyShiftOrder: 1,
      anchorDate: MON,
      requestDates: [THU, FRI],
    });

    // Shift 2 is the last in order: the day after it must be a rest day.
    expect((await fill(0, THU, 2)).ok).toBe(true);
    const refused = await fill(1, FRI, 2);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("day immediately after the last shift");
  });
});

describe("roster actions: suggestReplacementsAction", () => {
  test("clean candidates for an unfilled line; a fully-loaded date yields data: []", async () => {
    const fx = await createBase(`t6-sr-${randomUUID()}`, "suggest");
    const posA = await createPosition(fx, "sa");
    const posB = await createPosition(fx, "sb");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    // A higher-order shift keeps C4 (rest after the LAST shift) neutral.
    await createShift(fx, 2);
    await requireAreaPosition(fx, area, posA);
    await requireAreaPosition(fx, area, posB);
    const wBusy = await createWorker(fx, "busy");
    const wFree = await createWorker(fx, "free");
    await giveWorkerPosition(fx, wBusy, posA);
    await giveWorkerPosition(fx, wFree, posA);
    const wOnlyB = await createWorker(fx, "onlyb");
    await giveWorkerPosition(fx, wOnlyB, posB);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: TUE, headcount: 2, positionId: posA },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, suggestReplacementsAction } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    await db.update(rosterPlan).set({ status: "published" }).where(eq(rosterPlan.id, plan.id));

    // Context = the published week's rows: both posA holders work TUE, so
    // a TUE line admits nobody — empty data, still ok.
    const empty = await suggestReplacementsAction({
      workAreaId: area,
      shiftDefId: shift,
      date: TUE,
      positionId: posA,
    });
    expect(empty).toEqual({ ok: true, data: [] });

    // MON has no rows in the published week: the posA holders are clean
    // candidates; the posB-only worker is NOT — suggestions respect the
    // line's requested position.
    const fresh = (await suggestReplacementsAction({
      workAreaId: area,
      shiftDefId: shift,
      date: MON,
      positionId: posA,
    })) as { ok: true; data: { workerId: string; employeeId: string; reason: string }[] };
    expect(fresh.ok).toBe(true);
    expect(fresh.data.map((c) => c.workerId).sort()).toEqual([wBusy, wFree].sort());
    expect(fresh.data.every((c) => c.employeeId.startsWith("t-roster-emp-free-") || c.employeeId.startsWith("t-roster-emp-busy-"))).toBe(true);
    expect(fresh.data.every((c) => typeof c.reason === "string" && c.reason.length > 0)).toBe(true);
  });

  // A published week plus an open daily request for two heads on TUE, four
  // position holders, an admin actor. `idle` are the workers the weekly plan left off
  // MON, so their week counters only move through daily fills.
  async function setupDailySuggest(tag: string) {
    const fx = await createBase(`t159-${tag}-${randomUUID()}`, `suggest-${tag}`);
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createShift(fx, 2);
    const pos = await createPosition(fx, tag);
    await requireAreaPosition(fx, area, pos);
    const workers: string[] = [];
    for (let i = 0; i < 4; i++) {
      const w = await createWorker(fx, `w${i}`);
      await giveWorkerPosition(fx, w, pos);
      workers.push(w);
    }
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1, positionId: pos },
    ]);
    const tueRequest = await createRequest(fx, { type: "daily", requestDate: TUE });
    await addRequestLine(fx, tueRequest, {
      workAreaId: area,
      shiftDefinitionId: shift,
      date: TUE,
      headcount: 2,
      positionId: pos,
    });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [weeklyPlan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(weeklyPlan.id)).ok).toBe(true);
    const monRows = await readPlanRows(weeklyPlan.id);
    const idle = workers.filter((w) => !monRows.some((r) => r.workerId === w));

    const suggest = async (date: string) => {
      const { suggestReplacementsAction } = await import("./actions");
      const result = (await suggestReplacementsAction({
        workAreaId: area,
        shiftDefId: shift,
        date,
        positionId: pos,
      })) as { ok: true; data: { workerId: string; reason: string }[] };
      expect(result.ok).toBe(true);
      return result.data;
    };
    const fill = async (requestId: string, workerId: string, date: string) => {
      const { fillDailyRequest } = await import("./actions");
      return fillDailyRequest({
        requestId,
        workAreaId: area,
        shiftDefId: shift,
        date,
        positionId: pos,
        workerId,
        siteLocationId: fx.locationId,
      });
    };
    return { fx, area, shift, pos, idle, tueRequest, suggest, fill };
  }

  test("a worker already filled on the date through a daily request is not suggested for a second slot", async () => {
    const s = await setupDailySuggest("dup");
    const [filled] = s.idle;
    expect((await s.suggest(TUE)).map((c) => c.workerId)).toContain(filled);

    expect((await s.fill(s.tueRequest, filled, TUE)).ok).toBe(true);

    expect((await s.suggest(TUE)).map((c) => c.workerId)).not.toContain(filled);
  });

  test("an earlier daily fill of the week is counted in the suggestion's week counter", async () => {
    const s = await setupDailySuggest("week");
    const [filled, untouched] = s.idle;
    expect((await s.fill(s.tueRequest, filled, TUE)).ok).toBe(true);

    const wed = await s.suggest("2026-01-07");
    expect(wed.find((c) => c.workerId === filled)!.reason).toMatch(/^1 work days this week/);
    expect(wed.find((c) => c.workerId === untouched)!.reason).toMatch(/^0 work days this week/);
  });

  test("another location's daily fill on the same date does not change the suggestions", async () => {
    const s = await setupDailySuggest("foreign");
    const before = await s.suggest(TUE);

    const other = await createBase(`t159-oth-${randomUUID()}`, "suggest-other");
    const otherArea = await createWorkArea(other, "a");
    const otherShift = await createShift(other, 1);
    const otherWorker = await createWorker(other, "w");
    const planId = randomUUID();
    await db.insert(rosterPlan).values({
      id: planId,
      siteId: other.siteId,
      siteLocationId: other.locationId,
      kind: "daily",
      requestDate: TUE,
      status: "published",
      rulesSnapshot: {},
    });
    await db.insert(rosterAssignment).values({
      planId,
      siteId: other.siteId,
      siteLocationId: other.locationId,
      workerId: otherWorker,
      workAreaId: otherArea,
      shiftDefinitionId: otherShift,
      date: TUE,
    });

    expect(await s.suggest(TUE)).toEqual(before);
  });
});

describe("roster actions: session scope", () => {
  test("ho calls generate: rejected outright, nothing written", async () => {
    const fx = await createBase(`t6-ho-${randomUUID()}`, "ho");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    actor = makeActor("ho", fx.siteId, null);
    await seedUser(actor);

    const { generateRoster } = await import("./actions");
    const result = await generateRoster({
      weekStart: MON,
      siteLocationId: fx.locationId,
    });
    expect(result).toEqual({ ok: false, message: "Only admins generate rosters" });

    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(plans.length).toBe(0);
  });

  test("ho suggestions are limited to their own site: a foreign location's pick is refused with no worker identities", async () => {
    // Own site the ho is bound to, plus a foreign site's location whose
    // published roster WOULD leak worker identities through suggestions.
    const own = await createBase(`t6-hos-${randomUUID()}`, "ho-suggest-own");
    const foreign = await createBase(`t6-hof-${randomUUID()}`, "ho-suggest-foreign");
    const foreignArea = await createWorkArea(foreign, "fa");
    const foreignShift = await createShift(foreign, 1);
    await seedWeeklyDemand(foreign, [
      {
        workAreaId: foreignArea,
        shiftDefinitionId: foreignShift,
        date: MON,
        headcount: 1,
      },
    ]);
    actor = makeActor("admin", null, foreign.locationId);
    await seedUser(actor);

    const { generateRoster, suggestReplacementsAction } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: foreign.locationId })).ok).toBe(true);
    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, foreign.locationId));
    await db.update(rosterPlan).set({ status: "published" }).where(eq(rosterPlan.id, plan.id));

    // The call runs as an ho bound to the OTHER site, reaching across.
    actor = makeActor("ho", own.siteId, null);
    await seedUser(actor);

    const refused = await suggestReplacementsAction({
      workAreaId: foreignArea,
      shiftDefId: foreignShift,
      date: TUE,
      positionId: randomUUID(),
      siteLocationId: foreign.locationId,
    });
    expect(refused).toEqual({
      ok: false,
      message: "Suggestions are limited to your own site",
    });

    // Positive control: the ho's own-site location answers normally
    // (the read grant is site-scoped, not a blanket refusal).
    const ownPos = await createPosition(own, "op");
    const ownShift = await createShift(own, 1);
    const ownWorker = await createWorker(own, "ow");
    const ownArea = await createWorkArea(own, "oa");
    await requireAreaPosition(own, ownArea, ownPos);
    await giveWorkerPosition(own, ownWorker, ownPos);
    const allowed = (await suggestReplacementsAction({
      workAreaId: ownArea,
      shiftDefId: ownShift,
      date: TUE,
      positionId: ownPos,
      siteLocationId: own.locationId,
    })) as { ok: true; data: { workerId: string }[] };
    expect(allowed.ok).toBe(true);
    expect(allowed.data.map((c) => c.workerId)).toEqual([ownWorker]);
  });
});

describe("roster actions: revisePlan (guarded revise entry)", () => {
  test("audit actor + clone generated_by name the clicking admin, not the original generator", async () => {
    const fx = await createBase(`t6-rv-${randomUUID()}`, "revise-actor");
    const area = await createWorkArea(fx, "a");
    const shift1 = await createShift(fx, 1);
    await createShift(fx, 2);
    await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift1, date: MON, headcount: 1 },
    ]);
    const adminA = makeActor("admin", null, fx.locationId);
    await seedUser(adminA);
    actor = adminA;

    const { generateRoster, publishRoster, revisePlan } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [v1] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(v1.id)).ok).toBe(true);

    // A DIFFERENT admin of the same location clicks "Revise plan".
    const adminB = makeActor("admin", null, fx.locationId);
    await seedUser(adminB);
    actor = adminB;

    const result = await revisePlan(v1.id);
    expect(result.ok).toBe(true);

    const [clone] = await db
      .select()
      .from(rosterPlan)
      .where(
        and(
          eq(rosterPlan.siteLocationId, fx.locationId),
          eq(rosterPlan.status, "draft"),
        ),
      );
    expect(clone.id).toBe((result as { draftPlanId: string }).draftPlanId);
    expect(clone.version).toBe(2);
    expect(clone.generatedBy).toBe(adminB.id);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "roster.revise"),
          eq(auditLog.actorId, adminB.id),
        ),
      );
    expect(audit).toBeDefined();
    expect(audit.details).toEqual({
      planId: v1.id,
      newPlanId: clone.id,
      version: 2,
    });
  });

  test("ho revise: refused outright, nothing cloned", async () => {
    const fx = await createBase(`t6-rh-${randomUUID()}`, "revise-ho");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, revisePlan } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));

    actor = makeActor("ho", fx.siteId, null);
    await seedUser(actor);

    const result = await revisePlan(plan.id);
    expect(result).toEqual({ ok: false, message: "Only admins revise rosters" });

    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(plans.length).toBe(1);
  });
});

describe("roster actions: revise guard (decision-7, daily fills)", () => {
  test("ensureDraftVersion refuses while a daily plan covers the week; revisePlan surfaces the refusal", async () => {
    const fx = await createBase(`t6-rg-${randomUUID()}`, "revise-daily");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, revisePlan } = await import("./actions");
    const { ensureDraftVersion, ActionAbort } = await import(
      "@/lib/roster-plan-mutations"
    );
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [weekly] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));

    // A daily fill exists on the same week (TUE of the weekly plan's week).
    await db.insert(rosterPlan).values({
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      kind: "daily",
      requestDate: TUE,
      rulesSnapshot: {},
    });

    let aborted: unknown;
    try {
      await ensureDraftVersion(weekly.id, actor.id);
    } catch (err) {
      aborted = err;
    }
    expect(aborted).toBeInstanceOf(ActionAbort);
    expect((aborted as InstanceType<typeof ActionAbort>).state).toEqual({
      ok: false,
      message: "Daily fills exist for this week — clear them before revising",
    });

    // The guarded action surfaces the same refusal as an envelope.
    expect(await revisePlan(weekly.id)).toEqual({
      ok: false,
      message: "Daily fills exist for this week — clear them before revising",
    });

    // No clone was written.
    const plans = await db
      .select({ id: rosterPlan.id })
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect(plans.length).toBe(2); // the weekly draft + the daily plan only
  });
});

describe("roster actions: versioned prior history (revise-republish dedupe)", () => {
  test("after revise-publish v2, prior history holds one row per worker-day and the next week still generates", async () => {
    const fx = await createBase(`t6-pd-${randomUUID()}`, "prior-dedupe");
    const pos = await createPosition(fx, "pd");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shift1 = await createShift(fx, 1);
    await createShift(fx, 2); // keeps C4 (rest after the LAST shift) neutral
    const w1 = await createWorker(fx, "w1");
    const w2 = await createWorker(fx, "w2");
    await giveWorkerPosition(fx, w1, pos);
    await giveWorkerPosition(fx, w2, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift1, date: MON, headcount: 2, positionId: pos },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    const { ensureDraftVersion } = await import("@/lib/roster-plan-mutations");

    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [v1] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));
    expect((await publishRoster(v1.id)).ok).toBe(true);

    // v2: copy-on-edit revise, then drop one row so v2 ≠ v1.
    const v2Id = await ensureDraftVersion(v1.id, actor.id);
    await db
      .delete(rosterAssignment)
      .where(and(eq(rosterAssignment.planId, v2Id), eq(rosterAssignment.workerId, w2)));
    expect((await publishRoster(v2Id)).ok).toBe(true);

    // Both v1 and v2 of the SAME week are published now — prior history
    // must collapse to v2 only (one row per worker-day).
    const prior = await loadPriorAssignments(fx.locationId, NEXT_MON);
    expect(prior).toEqual([
      { workerId: w1, date: MON, shiftDefId: shift1, workAreaId: area },
    ]);

    // And the further week still fills (tightened C1 makes any doubled
    // history reject every candidate — the bricked-generation symptom).
    await tightenRule(fx, "C1", 1);
    const requestId = await createRequest(fx, {
      type: "weekly",
      weekStart: NEXT_MON,
    });
    await addRequestLine(fx, requestId, {
      workAreaId: area,
      shiftDefinitionId: shift1,
      date: NEXT_MON,
      headcount: 1,
      positionId: pos,
    });
    expect((await generateRoster({ weekStart: NEXT_MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [nextPlan] = await db
      .select()
      .from(rosterPlan)
      .where(
        and(
          eq(rosterPlan.siteLocationId, fx.locationId),
          eq(rosterPlan.weekStart, NEXT_MON),
        ),
      );
    expect(nextPlan).toBeDefined();
    const nextRows = await readPlanRows(nextPlan.id);
    expect(nextRows.length).toBe(1);
    expect(nextRows[0].date).toBe(NEXT_MON);
    expect(nextRows[0].workAreaId).toBe(area);
  });
});

describe("roster actions: publish gate horizon (retroactive tightening)", () => {
  test("prior-dated violations from a tightened rule warn but do not block the publish", async () => {
    const fx = await createBase(`t6-ph-${randomUUID()}`, "prior-horizon");
    const pos = await createPosition(fx, "ph");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shift1 = await createShift(fx, 1);
    await createShift(fx, 2); // keeps C4 neutral
    const w1 = await createWorker(fx, "w1");
    const w2 = await createWorker(fx, "w2");
    await giveWorkerPosition(fx, w1, pos);
    await giveWorkerPosition(fx, w2, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift1, date: MON, headcount: 1, positionId: pos },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { generateRoster, publishRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [v1] = await db
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.siteLocationId, fx.locationId));

    // The published week holds three worked days for w1 (legal under the
    // default C1 = 5 at publish time).
    for (const date of [TUE, "2026-01-07"]) {
      await db.insert(rosterAssignment).values({
        planId: v1.id,
        siteId: fx.siteId,
        siteLocationId: fx.locationId,
        workerId: w1,
        workAreaId: area,
        shiftDefinitionId: shift1,
        date,
      });
    }
    expect((await publishRoster(v1.id)).ok).toBe(true);

    // Retroactive tightening: C1 drops to 2 — the PUBLISHED history now
    // violates, the plan's own world is done with it.
    await tightenRule(fx, "C1", 2);

    // A next-week plan whose own rows are clean under C1 = 2.
    const requestId = await createRequest(fx, {
      type: "weekly",
      weekStart: NEXT_MON,
    });
    await addRequestLine(fx, requestId, {
      workAreaId: area,
      shiftDefinitionId: shift1,
      date: NEXT_MON,
      headcount: 1,
      positionId: pos,
    });
    expect((await generateRoster({ weekStart: NEXT_MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [nextPlan] = await db
      .select()
      .from(rosterPlan)
      .where(
        and(
          eq(rosterPlan.siteLocationId, fx.locationId),
          eq(rosterPlan.weekStart, NEXT_MON),
        ),
      );
    // The generator admits w2 (only the candidate worker's own horizon
    // gates admission); w1's prior-week excess is why the plan's own
    // world can still be clean while the history violates the tightened
    // rule.
    const nextRows = await readPlanRows(nextPlan.id);
    expect(nextRows).toEqual([
      { workerId: w2, workAreaId: area, shiftDefinitionId: shift1, date: NEXT_MON },
    ]);

    const result = await publishRoster(nextPlan.id);
    // Only the plan's own horizon can refuse; the prior-week excess of
    // the tightened rule is surfaced as a warning, not a refusal.
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Prior-plan warnings (not blocking)");
    expect(result.message).toContain("2026-01-07");

    const [after] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, nextPlan.id));
    expect(after.status).toBe("published");
    expect(after.publishedAt).not.toBeNull();
  });
});

describe("roster actions: publish fulfils approved requests", () => {
  async function seedLocation(tag: string) {
    const fx = await createBase(`t4-${tag}-${randomUUID()}`, tag);
    const pos = await createPosition(fx, "p");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, pos);
    const line = { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1, positionId: pos };
    return { fx, area, shift, pos, line };
  }

  async function requestStatus(id: string) {
    const [row] = await db
      .select({ status: mpRequest.status })
      .from(mpRequest)
      .where(eq(mpRequest.id, id));
    return row.status;
  }

  async function statusAudits(fx: BaseFixture) {
    return db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "mp_request.status_change"),
          eq(auditLog.siteLocationId, fx.locationId),
        ),
      );
  }

  async function generateDraft(fx: BaseFixture, weekStart = MON) {
    const { generateRoster } = await import("./actions");
    expect((await generateRoster({ weekStart, siteLocationId: fx.locationId })).ok).toBe(true);
    const plans = await db
      .select()
      .from(rosterPlan)
      .where(
        and(
          eq(rosterPlan.siteLocationId, fx.locationId),
          eq(rosterPlan.weekStart, weekStart),
          eq(rosterPlan.status, "draft"),
        ),
      );
    return plans[0];
  }

  test("publishing a weekly plan flips that location's approved weekly requests for that week to fulfilled, with one audit row each (auto: true)", async () => {
    const { fx, line } = await seedLocation("flip");
    const requestId = await seedWeeklyDemand(fx, [line]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster } = await import("./actions");
    const plan = await generateDraft(fx);
    expect(await requestStatus(requestId)).toBe("approved");

    expect((await publishRoster(plan.id)).ok).toBe(true);

    expect(await requestStatus(requestId)).toBe("fulfilled");
    const audits = await statusAudits(fx);
    expect(audits.length).toBe(1);
    expect(audits[0].actorId).toBe(actor.id);
    expect(audits[0].siteId).toBe(fx.siteId);
    expect(audits[0].details).toEqual({
      requestId,
      type: "weekly",
      oldValue: "approved",
      newValue: "fulfilled",
      auto: true,
    });
  });

  test("requests of another week or another location stay approved", async () => {
    const { fx, line } = await seedLocation("scope");
    const other = await seedLocation("scope-other");
    const target = await seedWeeklyDemand(fx, [line]);
    const otherWeek = await createRequest(fx, { type: "weekly", weekStart: NEXT_MON });
    await addRequestLine(fx, otherWeek, { ...line, date: NEXT_MON });
    const otherLocation = await seedWeeklyDemand(other.fx, [other.line]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster } = await import("./actions");
    const plan = await generateDraft(fx);
    expect((await publishRoster(plan.id)).ok).toBe(true);

    expect(await requestStatus(target)).toBe("fulfilled");
    expect(await requestStatus(otherWeek)).toBe("approved");
    expect(await requestStatus(otherLocation)).toBe("approved");
    expect((await statusAudits(other.fx)).length).toBe(0);
  });

  test("an open or rejected request of the same week is untouched", async () => {
    // A location holds one slot-holding (open/approved) request per week, so
    // the open case is a request reopened after the draft was generated.
    const { fx, line } = await seedLocation("nonapproved");
    const approved = await seedWeeklyDemand(fx, [line]);
    const rejected = await createRequest(fx, { type: "weekly", status: "rejected", weekStart: MON });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster } = await import("./actions");
    const plan = await generateDraft(fx);
    expect((await publishRoster(plan.id)).ok).toBe(true);
    expect(await requestStatus(approved)).toBe("fulfilled");
    expect(await requestStatus(rejected)).toBe("rejected");
    expect((await statusAudits(fx)).length).toBe(1);

    const reopened = await seedLocation("reopened");
    const openId = await seedWeeklyDemand(reopened.fx, [reopened.line]);
    actor = makeActor("admin", null, reopened.fx.locationId);
    await seedUser(actor);
    const openPlan = await generateDraft(reopened.fx);
    await db.update(mpRequest).set({ status: "open" }).where(eq(mpRequest.id, openId));
    expect((await publishRoster(openPlan.id)).ok).toBe(true);
    expect(await requestStatus(openId)).toBe("open");
    expect((await statusAudits(reopened.fx)).length).toBe(0);
  });

  test("a publish refused for blocking violations leaves requests approved", async () => {
    const { fx, area, pos, line } = await seedLocation("refused");
    const shiftHigh = await createShift(fx, 2);
    const requestId = await seedWeeklyDemand(fx, [
      { ...line, shiftDefinitionId: shiftHigh, positionId: pos },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster } = await import("./actions");
    const plan = await generateDraft(fx);
    const [row] = await db
      .select({ workerId: rosterAssignment.workerId })
      .from(rosterAssignment)
      .where(eq(rosterAssignment.planId, plan.id));
    // Plant a TUE row on a LOWER order index right after a MON higher shift:
    // a C3 downshift inside the plan week.
    await db.insert(rosterAssignment).values({
      planId: plan.id,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      workerId: row.workerId,
      workAreaId: area,
      shiftDefinitionId: line.shiftDefinitionId,
      date: TUE,
    });

    const result = await publishRoster(plan.id);
    expect(result.ok).toBe(false);

    expect(await requestStatus(requestId)).toBe("approved");
    expect((await statusAudits(fx)).length).toBe(0);
    const [planAfter] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, plan.id));
    expect(planAfter.status).toBe("draft");
  });

  test("publish with no approved request for the week succeeds and writes no mp_request.status_change rows", async () => {
    const { fx, line } = await seedLocation("noreq");
    const requestId = await seedWeeklyDemand(fx, [line]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster } = await import("./actions");
    const plan = await generateDraft(fx);
    // The request leaves the approved state after the draft was generated.
    await db.update(mpRequest).set({ status: "rejected" }).where(eq(mpRequest.id, requestId));

    expect((await publishRoster(plan.id)).ok).toBe(true);

    expect(await requestStatus(requestId)).toBe("rejected");
    expect((await statusAudits(fx)).length).toBe(0);
  });

  test("a late request approved after publish stays approved until the revision is published, then becomes fulfilled", async () => {
    const { fx, line } = await seedLocation("late");
    const first = await seedWeeklyDemand(fx, [line]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster, revisePlan } = await import("./actions");
    const v1 = await generateDraft(fx);
    expect((await publishRoster(v1.id)).ok).toBe(true);
    expect(await requestStatus(first)).toBe("fulfilled");

    // A second weekly request for the same week can only be approved once
    // the first left the slot-holding statuses (it is now fulfilled, which
    // holds no slot), so it lands after the publish.
    const late = await createRequest(fx, { type: "weekly", weekStart: MON });
    await addRequestLine(fx, late, line);
    expect(await requestStatus(late)).toBe("approved");

    const revised = await revisePlan(v1.id);
    expect(revised.ok).toBe(true);
    const draftId = (revised as { draftPlanId: string }).draftPlanId;
    expect(await requestStatus(late)).toBe("approved");

    expect((await publishRoster(draftId)).ok).toBe(true);
    expect(await requestStatus(late)).toBe("fulfilled");
    expect(await requestStatus(first)).toBe("fulfilled");
  });
});

describe("roster actions: discardDraft", () => {
  async function seedDiscardFixture(tag: string) {
    const fx = await createBase(`t4-dd-${tag}-${randomUUID()}`, tag);
    const pos = await createPosition(fx, "p");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, pos);
    const requestId = await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1, positionId: pos },
    ]);
    return { fx, area, shift, w, requestId };
  }

  async function generateWeeklyDraft(fx: BaseFixture) {
    const { generateRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(and(eq(rosterPlan.siteLocationId, fx.locationId), eq(rosterPlan.status, "draft")));
    return plan;
  }

  async function plansOf(fx: BaseFixture) {
    return db.select().from(rosterPlan).where(eq(rosterPlan.siteLocationId, fx.locationId));
  }

  async function rowsOf(planId: string) {
    return db.select().from(rosterAssignment).where(eq(rosterAssignment.planId, planId));
  }

  async function discardAudits(fx: BaseFixture) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "roster.discard"), eq(auditLog.siteLocationId, fx.locationId)));
  }

  test("admin discards a first draft: plan and its assignments are gone and one roster.discard audit row records it", async () => {
    const { fx } = await seedDiscardFixture("first");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { discardDraft } = await import("./actions");
    const plan = await generateWeeklyDraft(fx);
    const before = await rowsOf(plan.id);
    expect(before.length).toBeGreaterThan(0);

    const result = await discardDraft(plan.id);
    expect(result.ok).toBe(true);

    expect(await plansOf(fx)).toEqual([]);
    expect(await rowsOf(plan.id)).toEqual([]);

    const audits = await discardAudits(fx);
    expect(audits.length).toBe(1);
    expect(audits[0].actorId).toBe(actor.id);
    expect(audits[0].siteId).toBe(fx.siteId);
    expect(audits[0].details).toEqual({
      planId: plan.id,
      version: 1,
      weekStart: MON,
      assignmentCount: before.length,
    });
  });

  test("discarding a revision draft (version 2) leaves the published version 1 and all of its assignments intact and frees the draft slot", async () => {
    const { fx } = await seedDiscardFixture("revision");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster, revisePlan, discardDraft } = await import("./actions");
    const v1 = await generateWeeklyDraft(fx);
    expect((await publishRoster(v1.id)).ok).toBe(true);
    const v1Rows = await rowsOf(v1.id);
    expect(v1Rows.length).toBeGreaterThan(0);

    const revised = await revisePlan(v1.id);
    expect(revised.ok).toBe(true);
    const v2Id = (revised as { draftPlanId: string }).draftPlanId;
    const [v2] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, v2Id));
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    const v2Rows = await rowsOf(v2Id);

    expect((await discardDraft(v2Id)).ok).toBe(true);

    expect(await db.select().from(rosterPlan).where(eq(rosterPlan.id, v2Id))).toEqual([]);
    expect(await rowsOf(v2Id)).toEqual([]);
    const [v1After] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, v1.id));
    expect(v1After.status).toBe("published");
    expect((await rowsOf(v1.id)).length).toBe(v1Rows.length);

    const [audit] = await discardAudits(fx);
    expect(audit.details).toEqual({
      planId: v2Id,
      version: 2,
      weekStart: MON,
      assignmentCount: v2Rows.length,
    });

    // The one-live-draft slot is free again.
    expect((await revisePlan(v1.id)).ok).toBe(true);
  });

  test("a published plan is refused with the only-drafts message and nothing is deleted", async () => {
    const { fx } = await seedDiscardFixture("published");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    const { publishRoster, discardDraft } = await import("./actions");
    const plan = await generateWeeklyDraft(fx);
    expect((await publishRoster(plan.id)).ok).toBe(true);
    const rows = await rowsOf(plan.id);

    expect(await discardDraft(plan.id)).toEqual({
      ok: false,
      message: "Only drafts can be discarded.",
    });

    const [after] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, plan.id));
    expect(after.status).toBe("published");
    expect((await rowsOf(plan.id)).length).toBe(rows.length);
    expect(await discardAudits(fx)).toEqual([]);
  });

  test("a daily plan is refused with the only-weekly message and nothing is deleted", async () => {
    const { fx, area, shift, w } = await seedDiscardFixture("daily");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    // A daily plan carries the default draft status, so only the kind
    // check keeps it from being deleted.
    const [daily] = await db
      .insert(rosterPlan)
      .values({
        siteId: fx.siteId,
        siteLocationId: fx.locationId,
        kind: "daily",
        requestDate: TUE,
        weekStart: null,
        rulesSnapshot: {},
        generatedBy: actor.id,
      })
      .returning();
    expect(daily.status).toBe("draft");
    await db.insert(rosterAssignment).values({
      planId: daily.id,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      workerId: w,
      workAreaId: area,
      shiftDefinitionId: shift,
      date: TUE,
    });

    const { discardDraft } = await import("./actions");
    expect(await discardDraft(daily.id)).toEqual({
      ok: false,
      message: "Only weekly rosters can be discarded.",
    });

    expect((await plansOf(fx)).length).toBe(1);
    expect((await rowsOf(daily.id)).length).toBe(1);
    expect(await discardAudits(fx)).toEqual([]);
  });

  test("another location's plan is not found for an admin and stays intact", async () => {
    const own = await seedDiscardFixture("own");
    const foreign = await seedDiscardFixture("foreign");
    actor = makeActor("admin", null, foreign.fx.locationId);
    await seedUser(actor);
    const { discardDraft } = await import("./actions");
    const plan = await generateWeeklyDraft(foreign.fx);
    const rows = await rowsOf(plan.id);

    actor = makeActor("admin", null, own.fx.locationId);
    await seedUser(actor);

    expect(await discardDraft(plan.id)).toEqual({ ok: false, message: "Roster not found." });
    expect((await plansOf(foreign.fx)).length).toBe(1);
    expect((await rowsOf(plan.id)).length).toBe(rows.length);
    expect(await discardAudits(foreign.fx)).toEqual([]);
  });

  test("HO is refused with the HO message before any read and the plan is untouched", async () => {
    const { fx } = await seedDiscardFixture("ho");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);
    const { discardDraft } = await import("./actions");
    const plan = await generateWeeklyDraft(fx);
    const rows = await rowsOf(plan.id);

    actor = makeActor("ho", fx.siteId, null);
    await seedUser(actor);

    // A malformed id would be "not found" if any read ran first.
    expect(await discardDraft("not-a-uuid")).toEqual({
      ok: false,
      message: "Only admins discard drafts",
    });
    expect(await discardDraft(plan.id)).toEqual({
      ok: false,
      message: "Only admins discard drafts",
    });
    expect((await plansOf(fx)).length).toBe(1);
    expect((await rowsOf(plan.id)).length).toBe(rows.length);
  });

  test("superadmin may discard any weekly draft", async () => {
    const { fx } = await seedDiscardFixture("super");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);
    const { discardDraft } = await import("./actions");
    const plan = await generateWeeklyDraft(fx);

    actor = makeActor("superadmin", null, null);
    await seedUser(actor);

    expect((await discardDraft(plan.id)).ok).toBe(true);
    expect(await plansOf(fx)).toEqual([]);
    expect(await rowsOf(plan.id)).toEqual([]);
    const [audit] = await discardAudits(fx);
    expect(audit.actorId).toBe(actor.id);
    expect(audit.siteLocationId).toBe(fx.locationId);
  });

  test("approved requests of the week keep their status after a discard", async () => {
    const { fx, requestId } = await seedDiscardFixture("req");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);
    const { discardDraft } = await import("./actions");
    const plan = await generateWeeklyDraft(fx);

    expect((await discardDraft(plan.id)).ok).toBe(true);

    const [request] = await db.select().from(mpRequest).where(eq(mpRequest.id, requestId));
    expect(request.status).toBe("approved");
    const statusAudits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "mp_request.status_change"),
          eq(auditLog.siteLocationId, fx.locationId),
        ),
      );
    expect(statusAudits).toEqual([]);
  });

  test("a plan published before the delete runs is not deleted", async () => {
    const { fx } = await seedDiscardFixture("race");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);
    const { discardDraft } = await import("./actions");
    const plan = await generateWeeklyDraft(fx);
    const rows = await rowsOf(plan.id);

    // Another session publishes the plan and holds its row lock; discard
    // passes the ownership pre-check, then waits on the plan row. Once
    // the publish commits, the discard must see "published" and refuse.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const publisher = db.transaction(async (tx) => {
      await tx
        .update(rosterPlan)
        .set({ status: "published", publishedAt: new Date(), publishedBy: actor.id })
        .where(eq(rosterPlan.id, plan.id));
      locked();
      await gate;
    });
    await lockTaken;

    const discarding = discardDraft(plan.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await publisher;
    const result = await discarding;

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Only drafts can be discarded.");
    const [after] = await db.select().from(rosterPlan).where(eq(rosterPlan.id, plan.id));
    expect(after.status).toBe("published");
    expect((await rowsOf(plan.id)).length).toBe(rows.length);
    expect(await discardAudits(fx)).toEqual([]);
  });

  test("a discard racing a publish leaves one consistent outcome: exactly one wins and no plan loses its rows", async () => {
    const { fx } = await seedDiscardFixture("concurrent");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);
    const { discardDraft, publishRoster } = await import("./actions");
    const plan = await generateWeeklyDraft(fx);
    const rows = await rowsOf(plan.id);

    const [discarded, published] = await Promise.all([
      discardDraft(plan.id),
      publishRoster(plan.id),
    ]);

    expect([discarded.ok, published.ok].filter(Boolean).length).toBe(1);
    const remaining = await plansOf(fx);
    if (discarded.ok) {
      expect(remaining).toEqual([]);
      expect(await rowsOf(plan.id)).toEqual([]);
    } else {
      expect(remaining.length).toBe(1);
      expect(remaining[0].status).toBe("published");
      expect((await rowsOf(plan.id)).length).toBe(rows.length);
    }
  });

  test("a malformed id returns not found", async () => {
    const fx = await createBase(`t4-dd-bad-${randomUUID()}`, "bad");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);
    const { discardDraft } = await import("./actions");

    expect(await discardDraft("not-a-uuid")).toEqual({ ok: false, message: "Roster not found." });
    expect(await discardDraft(randomUUID())).toEqual({ ok: false, message: "Roster not found." });
  });
});

describe("roster actions: requests list revalidation", () => {
  const BOTH = ["/dashboard/requests", "/dashboard/roster"];

  async function seedFixture(tag: string) {
    const fx = await createBase(`t4-rv-${tag}-${randomUUID()}`, tag);
    const pos = await createPosition(fx, "p");
    const area = await createWorkArea(fx, "a");
    await requireAreaPosition(fx, area, pos);
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await giveWorkerPosition(fx, w, pos);
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1, positionId: pos },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);
    return { fx, pos, area, shift, w };
  }

  async function weeklyDraft(fx: BaseFixture) {
    const { generateRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
    const [plan] = await db
      .select()
      .from(rosterPlan)
      .where(and(eq(rosterPlan.siteLocationId, fx.locationId), eq(rosterPlan.status, "draft")));
    return plan;
  }

  test("generateRoster revalidates the roster and the requests list", async () => {
    const { fx } = await seedFixture("gen");
    revalidated = [];

    const { generateRoster } = await import("./actions");
    expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

    expect([...new Set(revalidated)].sort()).toEqual(BOTH);
  });

  test("discardDraft revalidates the roster and the requests list", async () => {
    const { fx } = await seedFixture("discard");
    const plan = await weeklyDraft(fx);
    revalidated = [];

    const { discardDraft } = await import("./actions");
    expect((await discardDraft(plan.id)).ok).toBe(true);

    expect([...new Set(revalidated)].sort()).toEqual(BOTH);
  });

  test("publishRoster revalidates the roster and the requests list", async () => {
    const { fx } = await seedFixture("publish");
    const plan = await weeklyDraft(fx);
    revalidated = [];

    const { publishRoster } = await import("./actions");
    expect((await publishRoster(plan.id)).ok).toBe(true);

    expect([...new Set(revalidated)].sort()).toEqual(BOTH);
  });

  test("fillDailyRequest revalidates the roster and the requests list", async () => {
    const { fx, pos, area, shift, w } = await seedFixture("fill");
    // A higher-order shift keeps C4 (rest after the LAST shift) neutral here.
    await createShift(fx, 2);
    const requestId = await createRequest(fx, { type: "daily", requestDate: TUE });
    const { publishRoster, fillDailyRequest } = await import("./actions");
    const plan = await weeklyDraft(fx);
    expect((await publishRoster(plan.id)).ok).toBe(true);
    revalidated = [];

    const result = await fillDailyRequest({
      requestId,
      workAreaId: area,
      shiftDefId: shift,
      date: TUE,
      positionId: pos,
      workerId: w,
      siteLocationId: fx.locationId,
    });
    expect(result.ok).toBe(true);

    expect([...new Set(revalidated)].sort()).toEqual(BOTH);
  });

  test("a refused publish does not revalidate anything", async () => {
    const { fx, w } = await seedFixture("refused");
    const plan = await weeklyDraft(fx);
    // The worker dies AFTER the draft was generated, so publishing is refused.
    await db.update(worker).set({ isActive: false }).where(eq(worker.id, w));
    revalidated = [];

    const { publishRoster } = await import("./actions");
    expect((await publishRoster(plan.id)).ok).toBe(false);

    expect(revalidated).toEqual([]);
  });
});
