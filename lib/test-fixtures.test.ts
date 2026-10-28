import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import {
  seedAssignment,
  seedAuditLog,
  seedLocation,
  seedMpRequest,
  seedPosition,
  seedRequestLine,
  seedRosterPlan,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
} from "./test-fixtures";
import { installCleanup, runTeardowns, type Cleanup } from "./test-cleanup";
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
} from "../drizzle/schema";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

const deletedAtOf = {
  site: async (id: string) =>
    (await db.select().from(site).where(eq(site.id, id)))[0]?.deletedAt,
  location: async (id: string) =>
    (await db.select().from(siteLocation).where(eq(siteLocation.id, id)))[0]
      ?.deletedAt,
  position: async (id: string) =>
    (await db.select().from(position).where(eq(position.id, id)))[0]
      ?.deletedAt,
  workArea: async (id: string) =>
    (await db.select().from(workArea).where(eq(workArea.id, id)))[0]
      ?.deletedAt,
  shift: async (id: string) =>
    (
      await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, id))
    )[0]?.deletedAt,
  worker: async (id: string) =>
    (await db.select().from(worker).where(eq(worker.id, id)))[0]?.deletedAt,
  user: async (id: string) =>
    (await db.select().from(user).where(eq(user.id, id)))[0]?.deletedAt,
};

describe("entity seeders", () => {
  test("a site is live by default and soft-deleted on request", async () => {
    const live = await seedSite(fixtureCleanup);
    const gone = await seedSite(fixtureCleanup, { deleted: true });

    expect(live.name).not.toBe(gone.name);
    expect(await deletedAtOf.site(live.id)).toBeNull();
    expect(await deletedAtOf.site(gone.id)).toBeInstanceOf(Date);
  });

  test("an explicit site name is used as given", async () => {
    const name = `t-fx-explicit-${randomUUID()}`;
    const s = await seedSite(fixtureCleanup, { name });

    expect(s.name).toBe(name);
  });

  test("a location is live by default and soft-deleted on request", async () => {
    const s = await seedSite(fixtureCleanup);
    const live = await seedLocation(fixtureCleanup, s.id);
    const gone = await seedLocation(fixtureCleanup, s.id, { deleted: true });

    expect(live.siteId).toBe(s.id);
    expect(await deletedAtOf.location(live.id)).toBeNull();
    expect(await deletedAtOf.location(gone.id)).toBeInstanceOf(Date);
  });

  test("a position is live by default and soft-deleted on request", async () => {
    const s = await seedSite(fixtureCleanup);
    const live = await seedPosition(fixtureCleanup, s.id);
    const gone = await seedPosition(fixtureCleanup, s.id, { deleted: true });

    expect(live.siteId).toBe(s.id);
    expect(await deletedAtOf.position(live.id)).toBeNull();
    expect(await deletedAtOf.position(gone.id)).toBeInstanceOf(Date);
  });

  test("a work area keeps its position links, live or soft-deleted", async () => {
    const s = await seedSite(fixtureCleanup);
    const loc = await seedLocation(fixtureCleanup, s.id);
    const pos = await seedPosition(fixtureCleanup, s.id);
    const live = await seedWorkArea(fixtureCleanup, loc, {
      positionIds: [pos.id],
    });
    const gone = await seedWorkArea(fixtureCleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await deletedAtOf.workArea(live.id)).toBeNull();
    expect(await deletedAtOf.workArea(gone.id)).toBeInstanceOf(Date);
    for (const area of [live, gone]) {
      expect(area.siteLocationId).toBe(loc.id);
      const links = await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, area.id));
      expect(links.map((l) => l.positionId)).toEqual([pos.id]);
    }
  });

  test("a work area without positions has no links", async () => {
    const s = await seedSite(fixtureCleanup);
    const loc = await seedLocation(fixtureCleanup, s.id);
    const area = await seedWorkArea(fixtureCleanup, loc);

    expect(
      await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, area.id)),
    ).toHaveLength(0);
  });

  test("a shift is live by default and soft-deleted on request", async () => {
    const s = await seedSite(fixtureCleanup);
    const loc = await seedLocation(fixtureCleanup, s.id);
    const live = await seedShift(fixtureCleanup, loc);
    const gone = await seedShift(fixtureCleanup, loc, {
      orderIndex: 2,
      deleted: true,
    });

    expect(live.orderIndex).toBe(1);
    expect(gone.orderIndex).toBe(2);
    expect(await deletedAtOf.shift(live.id)).toBeNull();
    expect(await deletedAtOf.shift(gone.id)).toBeInstanceOf(Date);
  });

  test("a worker keeps its position links, live or soft-deleted", async () => {
    const s = await seedSite(fixtureCleanup);
    const loc = await seedLocation(fixtureCleanup, s.id);
    const pos = await seedPosition(fixtureCleanup, s.id);
    const live = await seedWorker(fixtureCleanup, loc, {
      positionIds: [pos.id],
    });
    const gone = await seedWorker(fixtureCleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(live.employeeId).not.toBe(gone.employeeId);
    expect(await deletedAtOf.worker(live.id)).toBeNull();
    expect(await deletedAtOf.worker(gone.id)).toBeInstanceOf(Date);
    for (const w of [live, gone]) {
      expect(w.siteLocationId).toBe(loc.id);
      const links = await db
        .select()
        .from(workerPosition)
        .where(eq(workerPosition.workerId, w.id));
      expect(links.map((l) => l.positionId)).toEqual([pos.id]);
    }
  });

  test("a user is live by default and soft-deleted on request", async () => {
    const s = await seedSite(fixtureCleanup);
    const loc = await seedLocation(fixtureCleanup, s.id);
    const live = await seedUser(fixtureCleanup, {
      role: "admin",
      siteId: s.id,
      siteLocationId: loc.id,
    });
    const gone = await seedUser(fixtureCleanup, {
      role: "ho",
      siteId: s.id,
      deleted: true,
    });
    const root = await seedUser(fixtureCleanup, { role: "superadmin" });

    expect(live.email).not.toBe(gone.email);
    expect(live.email.endsWith("@shiftly.test")).toBe(true);
    expect(await deletedAtOf.user(live.id)).toBeNull();
    expect(await deletedAtOf.user(gone.id)).toBeInstanceOf(Date);
    expect(await deletedAtOf.user(root.id)).toBeNull();
    const [row] = await db.select().from(user).where(eq(user.id, live.id));
    expect(row).toMatchObject({
      role: "admin",
      siteId: s.id,
      siteLocationId: loc.id,
    });
  });
});

// One of everything, history included, seeded through a LOCAL cleanup so the
// test itself runs the teardowns and can look at what is left.
async function seedTree(cleanup: Cleanup) {
  const s = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, s.id);
  const pos = await seedPosition(cleanup, s.id);
  const area = await seedWorkArea(cleanup, loc, { positionIds: [pos.id] });
  const shift = await seedShift(cleanup, loc);
  const w = await seedWorker(cleanup, loc, { positionIds: [pos.id] });
  const u = await seedUser(cleanup, {
    role: "admin",
    siteId: s.id,
    siteLocationId: loc.id,
  });
  const plan = await seedRosterPlan(cleanup, loc, {
    generatedBy: u.id,
    publishedBy: u.id,
  });
  const request = await seedMpRequest(cleanup, loc, { createdBy: u.id });
  const audit = await seedAuditLog(cleanup, {
    actorId: u.id,
    siteId: s.id,
    siteLocationId: loc.id,
  });
  const assignment = await seedAssignment(cleanup, {
    planId: plan.id,
    loc,
    workerId: w.id,
    workAreaId: area.id,
    shiftId: shift.id,
  });
  const line = await seedRequestLine(cleanup, {
    requestId: request.id,
    loc,
    workAreaId: area.id,
    shiftId: shift.id,
    positionId: pos.id,
  });
  return { s, loc, pos, area, shift, w, u, plan, request, audit, assignment, line };
}

// One count per table, asserted separately: a leak in one table must not hide
// behind a total.
async function countRows(t: Awaited<ReturnType<typeof seedTree>>) {
  const count = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    site: await count(db.select().from(site).where(eq(site.id, t.s.id))),
    siteLocation: await count(
      db.select().from(siteLocation).where(eq(siteLocation.id, t.loc.id)),
    ),
    position: await count(
      db.select().from(position).where(eq(position.id, t.pos.id)),
    ),
    workArea: await count(
      db.select().from(workArea).where(eq(workArea.id, t.area.id)),
    ),
    workAreaPosition: await count(
      db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, t.area.id)),
    ),
    shiftDefinition: await count(
      db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, t.shift.id)),
    ),
    worker: await count(db.select().from(worker).where(eq(worker.id, t.w.id))),
    workerPosition: await count(
      db
        .select()
        .from(workerPosition)
        .where(eq(workerPosition.workerId, t.w.id)),
    ),
    user: await count(db.select().from(user).where(eq(user.id, t.u.id))),
    rosterPlan: await count(
      db.select().from(rosterPlan).where(eq(rosterPlan.id, t.plan.id)),
    ),
    mpRequest: await count(
      db.select().from(mpRequest).where(eq(mpRequest.id, t.request.id)),
    ),
    auditLog: await count(
      db.select().from(auditLog).where(eq(auditLog.id, t.audit.id)),
    ),
    rosterAssignment: await count(
      db
        .select()
        .from(rosterAssignment)
        .where(eq(rosterAssignment.id, t.assignment.id)),
    ),
    mpRequestLine: await count(
      db.select().from(mpRequestLine).where(eq(mpRequestLine.id, t.line.id)),
    ),
  };
}

describe("seeded tree teardown", () => {
  test("the full tree is seeded, then removed in foreign-key order", async () => {
    const pending: Array<() => Promise<unknown> | unknown> = [];
    const local: Cleanup = { defer: (teardown) => void pending.push(teardown) };
    // Safety net if an assertion below throws before the explicit run.
    fixtureCleanup.defer(() => runTeardowns(pending));

    const tree = await seedTree(local);
    const everyTable = {
      site: 1,
      siteLocation: 1,
      position: 1,
      workArea: 1,
      workAreaPosition: 1,
      shiftDefinition: 1,
      worker: 1,
      workerPosition: 1,
      user: 1,
      rosterPlan: 1,
      mpRequest: 1,
      auditLog: 1,
      rosterAssignment: 1,
      mpRequestLine: 1,
    };
    expect(await countRows(tree)).toEqual(everyTable);

    await runTeardowns([...pending]);

    expect(await countRows(tree)).toEqual(
      Object.fromEntries(
        Object.keys(everyTable).map((table) => [table, 0]),
      ) as typeof everyTable,
    );
  });

  test("teardowns are idempotent once the rows are already gone", async () => {
    const pending: Array<() => Promise<unknown> | unknown> = [];
    const local: Cleanup = { defer: (teardown) => void pending.push(teardown) };
    fixtureCleanup.defer(() => runTeardowns(pending));

    await seedTree(local);
    const again = [...pending];
    await runTeardowns(pending);

    await runTeardowns(again);
  });

  test("deleting a position's link rows first lets the position go", async () => {
    const pending: Array<() => Promise<unknown> | unknown> = [];
    const local: Cleanup = { defer: (teardown) => void pending.push(teardown) };
    fixtureCleanup.defer(() => runTeardowns(pending));

    const s = await seedSite(local);
    const loc = await seedLocation(local, s.id);
    const pos = await seedPosition(local, s.id);
    const area = await seedWorkArea(local, loc, { positionIds: [pos.id] });
    const w = await seedWorker(local, loc, { positionIds: [pos.id] });

    // Only the position's own teardown runs: it must clear the pivots itself.
    const positionTeardown = pending[2];
    await positionTeardown();

    expect(
      await db.select().from(position).where(eq(position.id, pos.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, area.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(workerPosition)
        .where(eq(workerPosition.workerId, w.id)),
    ).toHaveLength(0);
  });
});
