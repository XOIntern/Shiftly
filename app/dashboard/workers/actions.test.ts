import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  position,
  site,
  siteLocation,
  worker,
  workerPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The worker actions resolve their actor through requireUser — swapped
// for a stub so the real server actions read against the test database.
// The mock swaps the WHOLE module across bun's single test process, so every
// export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test — revalidation is a no-op stub.
// Real exports kept (revalidateTag, updateTag, … stay available to suites that
// run after this one: module mocks are process-wide); only revalidatePath is
// replaced, since there is no Next request context under bun test.
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T11 Worker Actor",
    email: `t11-wact-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// Standard two-site fixture: locations LA1/LA2 sit on site A, LB on site
// B; positions PA and PB parent to their own site's row so the composite
// worker FKs stay satisfiable while still offering a cross-site pick.
async function seedGlobalData() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA1 = randomUUID();
  const locA2 = randomUUID();
  const locB = randomUUID();
  const posA = randomUUID();
  const posB = randomUUID();

  await db.insert(site).values([
    { id: siteA, name: `t11-wact-s-a-${siteA}` },
    { id: siteB, name: `t11-wact-s-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: "T11 Wact Loc A1" },
    { id: locA2, siteId: siteA, name: "T11 Wact Loc A2" },
    { id: locB, siteId: siteB, name: "T11 Wact Loc B" },
  ]);
  await db.insert(position).values([
    { id: posA, siteId: siteA, name: "T11 Wact Pos A" },
    { id: posB, siteId: siteB, name: "T11 Wact Pos B" },
  ]);

  return { siteA, siteB, locA1, locA2, locB, posA, posB };
}

// Multi-position spec (2026-10-20): the qualification set lives in
// worker_position. These helpers seed and read it without going through the
// actions under test.
async function insertSiteAPosition(siteA: string, name: string) {
  const id = randomUUID();
  await db.insert(position).values({ id, siteId: siteA, name });
  return id;
}

async function seedWorkerWithPositions(args: {
  siteLocationId: string;
  siteId: string;
  employeeId: string;
  name: string;
  positionIds: string[];
}) {
  const id = randomUUID();
  await db.insert(worker).values({
    id,
    siteLocationId: args.siteLocationId,
    siteId: args.siteId,
    employeeId: args.employeeId,
    name: args.name,
  });
  await db.insert(workerPosition).values(
    args.positionIds.map((positionId) => ({
      workerId: id,
      positionId,
      siteId: args.siteId,
    })),
  );
  return id;
}

// A legacy worker row carries no contract_end_date.
async function seedLegacyWorker(
  fx: { locA1: string; siteA: string },
  wid: string,
  employeeId: string,
  name: string,
) {
  await db.insert(worker).values({
    id: wid,
    siteLocationId: fx.locA1,
    siteId: fx.siteA,
    employeeId,
    name,
  });
}

async function pivotPositions(workerId: string) {
  return db
    .select({
      id: workerPosition.positionId,
      siteId: workerPosition.siteId,
      name: position.name,
    })
    .from(workerPosition)
    .innerJoin(position, eq(workerPosition.positionId, position.id))
    .where(eq(workerPosition.workerId, workerId))
    .orderBy(asc(position.name));
}

// Child-first: pivot rows hold the RESTRICT FK, so they go before the worker.
async function dropWorkerById(id: string) {
  await db.delete(workerPosition).where(eq(workerPosition.workerId, id));
  await db.delete(worker).where(eq(worker.id, id));
}

async function dropWorkersByName(name: string) {
  const rows = await db
    .select({ id: worker.id })
    .from(worker)
    .where(eq(worker.name, name));
  for (const row of rows) await dropWorkerById(row.id);
}

async function dropWorkersByEmployeeId(employeeId: string) {
  const rows = await db
    .select({ id: worker.id })
    .from(worker)
    .where(eq(worker.employeeId, employeeId));
  for (const row of rows) await dropWorkerById(row.id);
}

async function dropSeed(fx: {
  siteA: string;
  siteB: string;
  locA1: string;
  locA2: string;
  locB: string;
  posA: string;
  posB: string;
}) {
  await db.delete(position).where(eq(position.id, fx.posA));
  await db.delete(position).where(eq(position.id, fx.posB));
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
  await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
  await db.delete(site).where(eq(site.id, fx.siteA));
  await db.delete(site).where(eq(site.id, fx.siteB));
}

describe("worker actions", () => {
  test("superadmin create derives site from the location: round-trips", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-rt");
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-rt",
      name: "T11 Wact Worker RT",
      contractEndDate: "2027-01-31",
    });

    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-rt"));
    expect(row).toBeDefined();
    // siteId was never sent: the action derived it from the location.
    expect(row.siteId).toBe(fx.siteA);
    expect(row.siteLocationId).toBe(fx.locA1);
    expect(row.name).toBe("T11 Wact Worker RT");
    expect(row.contractEndDate).toBe("2027-01-31");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();

    const pivot = await pivotPositions(row.id);
    expect(pivot.map((p) => p.id)).toEqual([fx.posA]);
    expect(pivot.every((p) => p.siteId === fx.siteA)).toBe(true);
  });

  test("ho create with another site's location: rejected with scope field error", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    actor = makeActor("ho", fx.siteA, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locB,
      positionIds: [fx.posB],
      employeeId: "t11-wact-emp-ho",
      name: "T11 Wact Worker HO",
      contractEndDate: "2027-01-31",
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.siteLocationId).toBe(
      "Location must be in your site",
    );

    // The refusal writes nothing.
    const rows = await db
      .select({ id: worker.id })
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-ho"));
    expect(rows.length).toBe(0);
  });

  test("admin create is pinned to their binding location and site's positions", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-adm");
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    actor = makeActor("admin", null, fx.locA1);

    const { createWorker } = await import("./actions");

    // A foreign position never lands under the pinned location.
    const foreignPos = await createWorker({
      siteLocationId: fx.locB,
      positionIds: [fx.posB],
      employeeId: "t11-wact-emp-adm",
      name: "T11 Wact Worker Adm",
      contractEndDate: "2027-01-31",
    });
    expect(foreignPos.ok).toBe(false);
    expect(foreignPos.fieldErrors?.positionIds).toBe(
      "Position must be in the same site as the location",
    );

    // The location pick is overridden to the admin's binding; the site
    // of their binding's positions is what a position check runs against.
    const result = await createWorker({
      siteLocationId: fx.locB,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-adm",
      name: "T11 Wact Worker Adm",
      contractEndDate: "2027-01-31",
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-adm"));
    expect(row.siteLocationId).toBe(fx.locA1);
    expect(row.siteId).toBe(fx.siteA);
  });

  test("create with a position from another site: rejected with same-site field error", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posB],
      employeeId: "t11-wact-emp-xs",
      name: "T11 Wact Worker XS",
      contractEndDate: "2027-01-31",
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.positionIds).toBe(
      "Position must be in the same site as the location",
    );

    const rows = await db
      .select({ id: worker.id })
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-xs"));
    expect(rows.length).toBe(0);
  });

  test("create duplicate employee_id in one location: mapped 23505 message", async () => {
    const fx = await seedGlobalData();
    const seeded = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-dup");
      await dropWorkersByName("T11 Wact Worker Dup II");
      await dropWorkersByName("T11 Wact Worker Dup III");
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    await db.insert(worker).values({
      id: seeded,
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-dup",
      name: "T11 Wact Worker Dup",
    });

    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-dup",
      name: "T11 Wact Worker Dup II",
      contractEndDate: "2027-01-31",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Employee ID already in use in this location");

    // The uniqueness is per location: another location still accepts it.
    const otherLoc = await createWorker({
      siteLocationId: fx.locA2,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-dup",
      name: "T11 Wact Worker Dup III",
      contractEndDate: "2027-01-31",
    });
    expect(otherLoc.ok).toBe(true);
  });

  test("ho update to another site's location: rejected with scope field error", async () => {
    const fx = await seedGlobalData();
    const wid = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    await db.insert(worker).values({
      id: wid,
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-umov",
      name: "T11 Wact Worker UMov",
    });

    actor = makeActor("ho", fx.siteA, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locB,
      positionIds: [fx.posB],
      employeeId: "t11-wact-emp-umov",
      name: "T11 Wact Worker UMov",
      contractEndDate: "2028-01-31",
      isActive: true,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.siteLocationId).toBe(
      "Location must be in your site",
    );

    // The refusal writes nothing to the existing row.
    const [row] = await db
      .select()
      .from(worker)
      .where(eq(worker.id, wid));
    expect(row.siteLocationId).toBe(fx.locA1);
    expect(row.siteId).toBe(fx.siteA);
    expect(row.contractEndDate).toBeNull();
  });

  test("superadmin update moves the worker across sites and positions", async () => {
    const fx = await seedGlobalData();
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mov",
      name: "T11 Wact Worker Mov",
      positionIds: [fx.posA],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locB,
      positionIds: [fx.posB],
      employeeId: "t11-wact-emp-mov",
      name: "T11 Wact Worker Moved",
      contractEndDate: "2028-06-30",
      isActive: false,
    });

    expect(result.ok).toBe(true);

    // Site and location move together — the site is derived from the new
    // location, so the composite FK pairing is consistent.
    const [row] = await db.select().from(worker).where(eq(worker.id, wid));
    expect(row.siteId).toBe(fx.siteB);
    expect(row.siteLocationId).toBe(fx.locB);
    expect(row.name).toBe("T11 Wact Worker Moved");
    expect(row.contractEndDate).toBe("2028-06-30");
    expect(row.isActive).toBe(false);

    // The old site-A set is replaced, not appended to: the pivot carries
    // exactly the new position, welded to the new site.
    const pivot = await pivotPositions(wid);
    expect(pivot.map((p) => p.id)).toEqual([fx.posB]);
    expect(pivot.every((p) => p.siteId === fx.siteB)).toBe(true);
  });

  test("update with inactive position: succeeds", async () => {
    const fx = await seedGlobalData();
    const inactivePos = randomUUID();
    const wid = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await db.delete(position).where(eq(position.id, inactivePos));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    await db.insert(position).values({
      id: inactivePos,
      siteId: fx.siteA,
      name: "T11 Wact Pos Inactive",
      isActive: false,
    });
    await db.insert(worker).values({
      id: wid,
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-inact",
      name: "T11 Wact Worker Inact",
    });

    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locA1,
      positionIds: [inactivePos],
      employeeId: "t11-wact-emp-inact",
      name: "T11 Wact Worker Inact",
      contractEndDate: "2028-01-31",
      isActive: true,
    });

    // An inactive position is accepted server-side: an edit that does
    // not touch the position must never fail because it was deactivated
    // since the picker snapshot.
    expect(result.ok).toBe(true);
    const attached = await pivotPositions(wid);
    expect(attached.map((p) => p.id)).toEqual([inactivePos]);
  });

  test("move onto duplicate employee_id in target location: 23505 mapped", async () => {
    const fx = await seedGlobalData();
    const w1 = randomUUID();
    const w2 = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkerById(w1);
      await dropWorkerById(w2);
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    // Both rows carry the same employee_id in DIFFERENT locations, which
    // the per-location unique index allows — until w2 moves onto w1's.
    await db.insert(worker).values([
      {
        id: w1,
        siteLocationId: fx.locA1,
        siteId: fx.siteA,
        employeeId: "t11-wact-emp-mdup",
        name: "T11 Wact Worker MDup 1",
        },
      {
        id: w2,
        siteLocationId: fx.locA2,
        siteId: fx.siteA,
        employeeId: "t11-wact-emp-mdup",
        name: "T11 Wact Worker MDup 2",
        },
    ]);

    // w2 already holds a qualification set; the refused move must restore
    // it rather than leave the pre-update delete committed.
    await db.insert(workerPosition).values({
      workerId: w2,
      positionId: fx.posA,
      siteId: fx.siteA,
    });

    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(w2, {
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-mdup",
      name: "T11 Wact Worker MDup 2",
      contractEndDate: "2028-01-31",
      isActive: true,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Employee ID already in use in this location");

    // The move is refused: w2 keeps its own location and its position set.
    const [row] = await db.select().from(worker).where(eq(worker.id, w2));
    expect(row.siteLocationId).toBe(fx.locA2);
    const pivot = await pivotPositions(w2);
    expect(pivot.map((p) => p.id)).toEqual([fx.posA]);
  });

  test("toggle and delete weld the scope: foreign worker answers not found", async () => {
    const fx = await seedGlobalData();
    const wid = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    await db.insert(worker).values({
      id: wid,
      siteLocationId: fx.locB,
      siteId: fx.siteB,
      employeeId: "t11-wact-emp-fn",
      name: "T11 Wact Worker FN",
    });

    actor = makeActor("ho", fx.siteA, null);

    const { toggleWorker, deleteWorker } = await import("./actions");

    const toggled = await toggleWorker(wid);
    expect(toggled).toEqual({ ok: false, message: "Worker not found." });

    const deleted = await deleteWorker(wid);
    expect(deleted).toEqual({ ok: false, message: "Worker not found." });

    // The refusals write nothing.
    const [row] = await db.select().from(worker).where(eq(worker.id, wid));
    expect(row.name).toBe("T11 Wact Worker FN");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
  });

  test("delete frees the employee_id in the location", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-free");
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker, toggleWorker, deleteWorker } =
      await import("./actions");
    const created = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-free",
      name: "T11 Wact Worker Free",
      contractEndDate: "2027-01-31",
    });
    expect(created.ok).toBe(true);

    const [row] = await db
      .select()
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-free"));
    expect(row).toBeDefined();

    // An in-scope toggle welds through: the worker flips inactive.
    const toggled = await toggleWorker(row.id);
    expect(toggled.ok).toBe(true);
    const [toggledRow] = await db
      .select({ isActive: worker.isActive })
      .from(worker)
      .where(eq(worker.id, row.id));
    expect(toggledRow.isActive).toBe(false);

    const deleted = await deleteWorker(row.id);
    expect(deleted.ok).toBe(true);
    const [softDeleted] = await db
      .select({ deletedAt: worker.deletedAt })
      .from(worker)
      .where(eq(worker.id, row.id));
    expect(softDeleted.deletedAt).not.toBeNull();

    // The freed per-location employee_id accepts a new worker again.
    const reCreated = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-free",
      name: "T11 Wact Worker Free II",
      contractEndDate: "2027-01-31",
    });
    expect(reCreated.ok).toBe(true);
  });

  test("deleteWorker on a missing worker: not found", async () => {
    actor = makeActor("superadmin", null, null);

    const { deleteWorker } = await import("./actions");
    const result = await deleteWorker(randomUUID());

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Worker not found.");
  });

  test("bulk actions apply only in-scope ids", async () => {
    const fx = await seedGlobalData();
    const wA1 = randomUUID();
    const wA2 = randomUUID();
    const wB1 = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wA1);
      await dropWorkerById(wA2);
      await dropWorkerById(wB1);
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    });
    await db.insert(worker).values([
      {
        id: wA1,
        siteLocationId: fx.locA1,
        siteId: fx.siteA,
        employeeId: "t11-wact-emp-b1",
        name: "T11 Wact Worker B1",
        },
      {
        id: wA2,
        siteLocationId: fx.locA2,
        siteId: fx.siteA,
        employeeId: "t11-wact-emp-b2",
        name: "T11 Wact Worker B2",
        },
      {
        id: wB1,
        siteLocationId: fx.locB,
        siteId: fx.siteB,
        employeeId: "t11-wact-emp-b3",
        name: "T11 Wact Worker B3",
        },
    ]);

    // Location-scoped: the admin welds on site_location_id, so the site
    // A pool only covers the wA rows.
    actor = makeActor("admin", null, fx.locA1);

    const { setActiveBulk, deleteBulk } = await import("./actions");

    const active = await setActiveBulk([wA1, wA2, wB1], false);
    expect(active.ok).toBe(true);
    expect(active.applied).toBe(1);
    const stateOf = async (id: string) => {
      const [row] = await db
        .select({ isActive: worker.isActive })
        .from(worker)
        .where(eq(worker.id, id));
      return row.isActive;
    };
    expect(await stateOf(wA1)).toBe(false);
    expect(await stateOf(wA2)).toBe(true);
    expect(await stateOf(wB1)).toBe(true);

    const removed = await deleteBulk([wA1, wB1]);
    expect(removed.ok).toBe(true);
    // Only the in-location row soft-deletes; workers have no children,
    // so nothing is ever blocked.
    expect(removed.applied).toBe(1);
    expect(removed.blocked).toBe(0);
    const [removedRow] = await db
      .select({ deletedAt: worker.deletedAt })
      .from(worker)
      .where(eq(worker.id, wA1));
    expect(removedRow.deletedAt).not.toBeNull();
    const [foreignRow] = await db
      .select({ deletedAt: worker.deletedAt })
      .from(worker)
      .where(eq(worker.id, wB1));
    expect(foreignRow.deletedAt).toBeNull();
  });
  test("create with two positions persists both", async () => {
    const fx = await seedGlobalData();
    const posA2 = await insertSiteAPosition(fx.siteA, "T11 Wact Pos A2");

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-mp-both");
      await db.delete(position).where(eq(position.id, posA2));
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA, posA2],
      employeeId: "t11-wact-emp-mp-both",
      name: "T11 Wact Worker MP Both",
      contractEndDate: "2027-01-31",
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-mp-both"));
    const pivot = await pivotPositions(row.id);
    // Every position is equal: no primary, no order, both persisted.
    expect(pivot.map((p) => p.id).sort()).toEqual([fx.posA, posA2].sort());
    expect(pivot.every((p) => p.siteId === fx.siteA)).toBe(true);
  });

  test("create with an empty set: rejected", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-mp-empty");
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [],
      employeeId: "t11-wact-emp-mp-empty",
      name: "T11 Wact Worker MP Empty",
      contractEndDate: "2027-01-31",
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.positionIds).toBeDefined();

    const rows = await db
      .select({ id: worker.id })
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-mp-empty"));
    expect(rows).toHaveLength(0);
  });

  test("create with duplicate ids: rejected with 'Select each position once'", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-mp-dup");
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA, fx.posA],
      employeeId: "t11-wact-emp-mp-dup",
      name: "T11 Wact Worker MP Dup",
      contractEndDate: "2027-01-31",
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.positionIds).toBe("Select each position once");

    const rows = await db
      .select({ id: worker.id })
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-mp-dup"));
    expect(rows).toHaveLength(0);
  });

  test("create with a mixed-site set: rejected with the same-site field error", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-mp-mixed");
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA, fx.posB],
      employeeId: "t11-wact-emp-mp-mixed",
      name: "T11 Wact Worker MP Mixed",
      contractEndDate: "2027-01-31",
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.positionIds).toBe(
      "Position must be in the same site as the location",
    );

    const rows = await db
      .select({ id: worker.id })
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-mp-mixed"));
    expect(rows).toHaveLength(0);
  });

  test("update replaces the position set", async () => {
    const fx = await seedGlobalData();
    const posA2 = await insertSiteAPosition(fx.siteA, "T11 Wact Pos A2");
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mp-rep",
      name: "T11 Wact Worker MP Rep",
      positionIds: [fx.posA],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await db.delete(position).where(eq(position.id, posA2));
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locA1,
      positionIds: [posA2],
      employeeId: "t11-wact-emp-mp-rep",
      name: "T11 Wact Worker MP Rep",
      contractEndDate: "2028-01-31",
      isActive: true,
    });
    expect(result.ok).toBe(true);

    const pivot = await pivotPositions(wid);
    // The removed id is gone, the added id is present.
    expect(pivot.map((p) => p.id)).toEqual([posA2]);
  });

  test("update with an empty set: rejected", async () => {
    const fx = await seedGlobalData();
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mp-uempty",
      name: "T11 Wact Worker MP UEmpty",
      positionIds: [fx.posA],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locA1,
      positionIds: [],
      employeeId: "t11-wact-emp-mp-uempty",
      name: "T11 Wact Worker MP UEmpty",
      contractEndDate: "2028-01-31",
      isActive: true,
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.positionIds).toBeDefined();

    const pivot = await pivotPositions(wid);
    expect(pivot.map((p) => p.id)).toEqual([fx.posA]);
  });

  test("superadmin cross-site move rewrites the pivot site_id", async () => {
    const fx = await seedGlobalData();
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mp-xsite",
      name: "T11 Wact Worker MP XSite",
      positionIds: [fx.posA],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locB,
      positionIds: [fx.posB],
      employeeId: "t11-wact-emp-mp-xsite",
      name: "T11 Wact Worker MP XSite",
      contractEndDate: "2028-01-31",
      isActive: true,
    });
    expect(result.ok).toBe(true);

    const pivot = await pivotPositions(wid);
    expect(pivot.map((p) => p.id)).toEqual([fx.posB]);
    // No row may still point at the old site.
    expect(pivot.every((p) => p.siteId === fx.siteB)).toBe(true);
    expect(pivot.some((p) => p.id === fx.posA)).toBe(false);
  });

  test("ho cross-site move: rejected, pivot untouched", async () => {
    const fx = await seedGlobalData();
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mp-hox",
      name: "T11 Wact Worker MP HOX",
      positionIds: [fx.posA],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await dropSeed(fx);
    });
    actor = makeActor("ho", fx.siteA, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locB,
      positionIds: [fx.posB],
      employeeId: "t11-wact-emp-mp-hox",
      name: "T11 Wact Worker MP HOX",
      contractEndDate: "2028-01-31",
      isActive: true,
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.siteLocationId).toBe(
      "Location must be in your site",
    );

    const pivot = await pivotPositions(wid);
    expect(pivot.map((p) => p.id)).toEqual([fx.posA]);
    expect(pivot.every((p) => p.siteId === fx.siteA)).toBe(true);
  });

  test("update on a foreign worker: not found, pivot untouched", async () => {
    const fx = await seedGlobalData();
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locB,
      siteId: fx.siteB,
      employeeId: "t11-wact-emp-mp-foreign",
      name: "T11 Wact Worker MP Foreign",
      positionIds: [fx.posB],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await dropSeed(fx);
    });
    actor = makeActor("ho", fx.siteA, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-mp-foreign",
      name: "T11 Wact Worker MP Foreign",
      isActive: true,
    });
    expect(result).toEqual({ ok: false, message: "Worker not found." });

    const pivot = await pivotPositions(wid);
    expect(pivot.map((p) => p.id)).toEqual([fx.posB]);
    expect(pivot.every((p) => p.siteId === fx.siteB)).toBe(true);
  });

  test("update on a soft-deleted worker: not found, pivot untouched", async () => {
    const fx = await seedGlobalData();
    const secondPos = await insertSiteAPosition(fx.siteA, "t11-wact-pos-gone-b");
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mp-gone",
      name: "T11 Wact Worker MP Gone",
      positionIds: [fx.posA, secondPos],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await db.delete(position).where(eq(position.id, secondPos));
      await dropSeed(fx);
    });
    // The superadmin ownership pre-check always passes, so the welded
    // update inside the transaction is what reports the vanished worker.
    actor = makeActor("superadmin", null, null);
    await db
      .update(worker)
      .set({ deletedAt: new Date() })
      .where(eq(worker.id, wid));

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-mp-gone",
      name: "T11 Wact Worker MP Gone",
      contractEndDate: "2028-01-31",
      isActive: true,
    });
    expect(result).toEqual({ ok: false, message: "Worker not found." });

    // The not-found path must not commit the pivot delete that ran before
    // the welded update returned zero rows.
    const pivot = await pivotPositions(wid);
    expect(pivot.map((p) => p.id).sort()).toEqual(
      [fx.posA, secondPos].sort(),
    );
    expect(pivot.every((p) => p.siteId === fx.siteA)).toBe(true);
  });

  test("update with an attached inactive position: succeeds and keeps it", async () => {
    const fx = await seedGlobalData();
    const inactivePos = randomUUID();
    await db.insert(position).values({
      id: inactivePos,
      siteId: fx.siteA,
      name: "T11 Wact Pos Inactive MP",
      isActive: false,
    });
    const wid = await seedWorkerWithPositions({
      siteLocationId: fx.locA1,
      siteId: fx.siteA,
      employeeId: "t11-wact-emp-mp-inact",
      name: "T11 Wact Worker MP Inact",
      positionIds: [inactivePos],
    });

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await db.delete(position).where(eq(position.id, inactivePos));
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const result = await updateWorker(wid, {
      siteLocationId: fx.locA1,
      positionIds: [inactivePos],
      employeeId: "t11-wact-emp-mp-inact",
      name: "T11 Wact Worker MP Inact",
      contractEndDate: "2028-01-31",
      isActive: true,
    });
    expect(result.ok).toBe(true);

    // An unrelated edit never silently drops a deactivated attachment.
    const pivot = await pivotPositions(wid);
    expect(pivot.map((p) => p.id)).toEqual([inactivePos]);
  });

  test("create without contract end: refused with a contractEndDate field error", async () => {
    const fx = await seedGlobalData();

    fixtureCleanup.defer(async () => {
      await dropWorkersByEmployeeId("t11-wact-emp-ce-req");
      await dropSeed(fx);
    });
    actor = makeActor("superadmin", null, null);

    const { createWorker } = await import("./actions");
    const result = await createWorker({
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-ce-req",
      name: "T11 Wact Worker CeReq",
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.contractEndDate).toBe(
      "Contract end is required",
    );

    // The refusal writes nothing.
    const rows = await db
      .select({ id: worker.id })
      .from(worker)
      .where(eq(worker.employeeId, "t11-wact-emp-ce-req"));
    expect(rows).toHaveLength(0);
  });

  test("legacy worker update without contract end: refused, row byte-identical", async () => {
    const fx = await seedGlobalData();
    const wid = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await dropSeed(fx);
    });
    // A legacy row: contract_end_date is NULL.
    await seedLegacyWorker(fx, wid, "t11-wact-emp-ce-legacy", "T11 Wact Worker CeLegacy");

    actor = makeActor("superadmin", null, null);

    const { updateWorker } = await import("./actions");
    const [before] = await db.select().from(worker).where(eq(worker.id, wid));

    const result = await updateWorker(wid, {
      siteLocationId: fx.locA1,
      positionIds: [fx.posA],
      employeeId: "t11-wact-emp-ce-legacy",
      name: "T11 Wact Worker CeLegacy",
      isActive: true,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.contractEndDate).toBe(
      "Contract end is required",
    );

    // The refused edit leaves the row byte-identical — no column moves,
    // not even updated_at.
    const [after] = await db.select().from(worker).where(eq(worker.id, wid));
    expect(after).toEqual(before);
  });

  test("legacy worker toggle: still succeeds without any contract end", async () => {
    const fx = await seedGlobalData();
    const wid = randomUUID();

    fixtureCleanup.defer(async () => {
      await dropWorkerById(wid);
      await dropSeed(fx);
    });
    await seedLegacyWorker(fx, wid, "t11-wact-emp-ce-legacy-tgl", "T11 Wact Worker CeLegacyTgl");

    actor = makeActor("superadmin", null, null);

    // toggleWorker never parses the create/update schema: deactivation
    // works on legacy rows that carry no date.
    const { toggleWorker } = await import("./actions");
    const toggled = await toggleWorker(wid);
    expect(toggled.ok).toBe(true);

    const [row] = await db
      .select({ isActive: worker.isActive })
      .from(worker)
      .where(eq(worker.id, wid));
    expect(row.isActive).toBe(false);
  });
});
