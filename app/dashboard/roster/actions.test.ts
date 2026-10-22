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
// No Next request context under bun test — revalidation is a no-op stub.
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

// A known Monday and the days after it.
const MON = "2026-01-05";
const TUE = "2026-01-06";

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

async function createWorkArea(fx: BaseFixture, tag: string): Promise<string> {
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

async function createShift(
  fx: BaseFixture,
  orderIndex: number,
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
  args: { type: "weekly" | "daily"; status?: "received" | "processing"; weekStart?: string; requestDate?: string },
): Promise<string> {
  const id = randomUUID();
  createdRequestIds.push(id);
  await db.insert(mpRequest).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    type: args.type,
    status: args.status ?? "received",
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
  args: { workAreaId: string; shiftDefinitionId: string; date: string; headcount?: number },
): Promise<void> {
  await db.insert(mpRequestLine).values({
    requestId,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    workAreaId: args.workAreaId,
    shiftDefinitionId: args.shiftDefinitionId,
    date: args.date,
    headcount: args.headcount ?? 1,
  });
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

async function seedWeeklyDemand(fx: BaseFixture, lines: { workAreaId: string; shiftDefinitionId: string; date: string; headcount?: number }[]) {
  const requestId = await createRequest(fx, { type: "weekly", weekStart: MON });
  for (const line of lines) await addRequestLine(fx, requestId, line);
  return requestId;
}

afterAll(async () => {
  // Audit pins the actor user; the action-created plans/assignments are
  // deleted by this suite's own locations (presence-scoped, not global).
  if (createdUserIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.actorId, createdUserIds));
  }
  for (const locId of createdLocationIds) {
    await db.delete(rosterAssignment).where(eq(rosterAssignment.siteLocationId, locId));
    await db.delete(rosterPlan).where(eq(rosterPlan.siteLocationId, locId));
    await db.delete(mpRequestLine).where(eq(mpRequestLine.siteLocationId, locId));
    await db.delete(mpRequest).where(eq(mpRequest.siteLocationId, locId));
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
});

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

describe("roster actions: generateRoster", () => {
  test("admin generate happy: plan + rows + audit present, rulesSnapshot matches the resolved rules", async () => {
    const fx = await createBase(`t6-gh-${randomUUID()}`, "gen-happy");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const w1 = await createWorker(fx, "w1");
    const w2 = await createWorker(fx, "w2");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 2 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
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
    } finally {
      void fx;
    }
  });

  test("generate without received requirements for the week: refused, nothing written", async () => {
    const fx = await createBase(`t6-gn-${randomUUID()}`, "gen-noreq");
    await createWorkArea(fx, "a");
    await createShift(fx, 1);
    await createWorker(fx, "w");
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
      const { generateRoster } = await import("./actions");
      const result = await generateRoster({ weekStart: MON, siteLocationId: fx.locationId });
      expect(result).toEqual({
        ok: false,
        message: "No received requests cover this week",
      });

      const plans = await db
        .select({ id: rosterPlan.id })
        .from(rosterPlan)
        .where(eq(rosterPlan.siteLocationId, fx.locationId));
      expect(plans.length).toBe(0);
    } finally {
      void fx;
    }
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

    try {
      const { generateRoster } = await import("./actions");
      expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);

      const second = await generateRoster({ weekStart: MON, siteLocationId: fx.locationId });
      expect(second).toEqual({ ok: false, message: "Draft already exists" });

      const plans = await db
        .select({ id: rosterPlan.id })
        .from(rosterPlan)
        .where(eq(rosterPlan.siteLocationId, fx.locationId));
      expect(plans.length).toBe(1);
    } finally {
      void fx;
    }
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
      { workAreaId: areaA, shiftDefinitionId: shiftA, date: MON, headcount: 1 },
      { workAreaId: areaB, shiftDefinitionId: shiftB, date: TUE, headcount: 1 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
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
    } finally {
      void fx;
    }
  });
});

describe("roster actions: publishRoster", () => {
  async function seedPublishFixture() {
    const fx = await createBase(`t6-p-${randomUUID()}`, "pub");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    const w = await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    return { fx, area, shift, w };
  }

  test("publish blocked by a planted downshift: refusal carries the violation, plan stays draft", async () => {
    const fx = await createBase(`t6-p-${randomUUID()}`, "pub-down");
    const area = await createWorkArea(fx, "a");
    const shiftLow = await createShift(fx, 1);
    const shiftHigh = await createShift(fx, 2);
    const w = await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shiftHigh, date: MON, headcount: 1 },
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

      const [planAfter] = await db
        .select()
        .from(rosterPlan)
        .where(eq(rosterPlan.id, plan.id));
      expect(planAfter.status).toBe("draft");
      expect(planAfter.publishedAt).toBeNull();
      expect(planAfter.publishedBy).toBeNull();
    } finally {
      void fx;
    }
  });

  test("publish blocked by a worker deactivated after generation: refusal, not a silent publish", async () => {
    const { fx, w } = await seedPublishFixture();
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
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
    } finally {
      void fx;
    }
  });

  test("publish happy: published fields + audit with zero violations", async () => {
    const { fx, w } = await seedPublishFixture();
    void w;
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
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
    } finally {
      void fx;
    }
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

    try {
      const { generateRoster, setAssignment, ensureDraftVersion } = await import("./actions");
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
    } finally {
      void fx;
    }
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

    try {
      const { generateRoster, applyAssignmentEdit } = await import("./actions");
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
    } finally {
      void fx;
    }
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

    try {
      const { fillDailyRequest } = await import("./actions");
      const result = await fillDailyRequest({
        requestId,
        workAreaId: area,
        shiftDefId: shift,
        date: TUE,
        workerId: w,
        siteLocationId: fx.locationId,
      });
      expect(result).toEqual({ ok: false, message: "Publish the weekly roster first" });

      const plans = await db
        .select({ id: rosterPlan.id })
        .from(rosterPlan)
        .where(eq(rosterPlan.siteLocationId, fx.locationId));
      expect(plans.length).toBe(0);
    } finally {
      void fx;
    }
  });

  test("daily fill happy: daily plan + assignment + audit over the published week", async () => {
    const fx = await createBase(`t6-dh-${randomUUID()}`, "daily-happy");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    // A higher-order shift keeps C4 (rest after the LAST shift) neutral in
    // this fixture — the fill's admission loop must be free to admit TUE.
    await createShift(fx, 2);
    const w = await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    const requestId = await createRequest(fx, { type: "daily", requestDate: TUE });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
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
      expect(audit.details).toEqual({ requestId, workerId: w, date: TUE });
    } finally {
      void fx;
    }
  });

  test("double daily fill on the same date: friendly duplicate message", async () => {
    const fx = await createBase(`t6-dd-${randomUUID()}`, "daily-dup");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    await createShift(fx, 2);
    const w = await createWorker(fx, "w");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: MON, headcount: 1 },
    ]);
    const requestId = await createRequest(fx, { type: "daily", requestDate: TUE });
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
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
    } finally {
      void fx;
    }
  });
});

describe("roster actions: suggestReplacementsAction", () => {
  test("clean candidates for an unfilled line; a fully-loaded date yields data: []", async () => {
    const fx = await createBase(`t6-sr-${randomUUID()}`, "suggest");
    const area = await createWorkArea(fx, "a");
    const shift = await createShift(fx, 1);
    // A higher-order shift keeps C4 (rest after the LAST shift) neutral.
    await createShift(fx, 2);
    const wBusy = await createWorker(fx, "busy");
    const wFree = await createWorker(fx, "free");
    await seedWeeklyDemand(fx, [
      { workAreaId: area, shiftDefinitionId: shift, date: TUE, headcount: 2 },
    ]);
    actor = makeActor("admin", null, fx.locationId);
    await seedUser(actor);

    try {
      const { generateRoster, suggestReplacementsAction } = await import("./actions");
      expect((await generateRoster({ weekStart: MON, siteLocationId: fx.locationId })).ok).toBe(true);
      const [plan] = await db
        .select()
        .from(rosterPlan)
        .where(eq(rosterPlan.siteLocationId, fx.locationId));
      await db.update(rosterPlan).set({ status: "published" }).where(eq(rosterPlan.id, plan.id));

      // Context = the published week's rows: both workers work TUE, so a
      // TUE line admits nobody — empty data, still ok.
      const empty = await suggestReplacementsAction({
        workAreaId: area,
        shiftDefId: shift,
        date: TUE,
      });
      expect(empty).toEqual({ ok: true, data: [] });

      // MON has no rows in the published week: both workers are clean
      // candidates, each carrying workerId + employeeId + reason.
      const fresh = (await suggestReplacementsAction({
        workAreaId: area,
        shiftDefId: shift,
        date: MON,
      })) as { ok: true; data: { workerId: string; employeeId: string; reason: string }[] };
      expect(fresh.ok).toBe(true);
      expect(fresh.data.map((c) => c.workerId).sort()).toEqual([wBusy, wFree].sort());
      expect(fresh.data.every((c) => c.employeeId.startsWith("t-roster-emp-free-") || c.employeeId.startsWith("t-roster-emp-busy-"))).toBe(true);
      expect(fresh.data.every((c) => typeof c.reason === "string" && c.reason.length > 0)).toBe(true);
    } finally {
      void fx;
    }
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

    try {
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
    } finally {
      void fx;
    }
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

    try {
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
        siteLocationId: foreign.locationId,
      });
      expect(refused).toEqual({
        ok: false,
        message: "Suggestions are limited to your own site",
      });

      // Positive control: the ho's own-site location answers normally
      // (the read grant is site-scoped, not a blanket refusal).
      const ownShift = await createShift(own, 1);
      const ownWorker = await createWorker(own, "ow");
      const ownArea = await createWorkArea(own, "oa");
      const allowed = (await suggestReplacementsAction({
        workAreaId: ownArea,
        shiftDefId: ownShift,
        date: TUE,
        siteLocationId: own.locationId,
      })) as { ok: true; data: { workerId: string }[] };
      expect(allowed.ok).toBe(true);
      expect(allowed.data.map((c) => c.workerId)).toEqual([ownWorker]);
    } finally {
      void own;
      void foreign;
    }
  });
});
