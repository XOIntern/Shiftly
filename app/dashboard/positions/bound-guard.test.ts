import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

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

// The position actions resolve their actor through requireUser — swapped
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
    name: "T12 Position Actor",
    email: `t12-wbg-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// Seeds site A + a live location + the requested positions; a live worker
// referencing the first position can be attached on top. Returns the ids so
// tests wire guards and cleanup without re-querying.
async function seedSiteWithPositions(positionNames: string[]) {
  const siteA = randomUUID();
  const locA = randomUUID();

  await db.insert(site).values([{ id: siteA, name: `t12-wbg-s-a-${siteA}` }]);
  await db.insert(siteLocation).values({
    id: locA,
    siteId: siteA,
    name: `t12-wbg-loc-${locA}`,
  });
  const positionIds = positionNames.map(() => randomUUID());
  await db.insert(position).values(
    positionNames.map((name, index) => ({
      id: positionIds[index],
      siteId: siteA,
      name: `t12-wbg-${name}`,
    })),
  );

  const cleanup = async () => {
    // Child-first: the pivot rows hold the RESTRICT composite FKs.
    const workerRows = await db
      .select({ id: worker.id })
      .from(worker)
      .where(eq(worker.siteId, siteA));
    for (const row of workerRows) {
      await db
        .delete(workerPosition)
        .where(eq(workerPosition.workerId, row.id));
    }
    await db.delete(worker).where(eq(worker.siteId, siteA));
    for (const id of positionIds) {
      await db.delete(position).where(eq(position.id, id));
    }
    await db.delete(siteLocation).where(eq(siteLocation.id, locA));
    await db.delete(site).where(eq(site.id, siteA));
  };
  return { siteA, locA, positionIds, cleanup };
}

// A worker holding the given set: the pivot is the only source of position
// qualifications.
async function seedWorkerHolding(
  positionIds: string[],
  siteId: string,
  locId: string,
) {
  const [row] = await db
    .insert(worker)
    .values({
      siteLocationId: locId,
      siteId,
      employeeId: `t12-wbg-${randomUUID()}`,
      name: "T12 WBG Worker",
    })
    .returning({ id: worker.id });
  await db.insert(workerPosition).values(
    positionIds.map((positionId) => ({
      workerId: row.id,
      positionId,
      siteId,
    })),
  );
  return row.id;
}

async function seedLiveWorker(
  positionId: string,
  siteId: string,
  locId: string,
) {
  return seedWorkerHolding([positionId], siteId, locId);
}

describe("position bound-guard", () => {
  test("deletePosition with a live worker: blocked with the worker message", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa"]);
    const [positionP] = positionIds;

    fixtureCleanup.defer(async () => {
      await cleanup();
    });
    await seedLiveWorker(positionP, siteA, locA);
    actor = makeActor("superadmin", null, null);

    const { deletePosition } = await import("./actions");
    const result = await deletePosition(positionP);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Some workers still reference this position");

    // The refusal writes nothing: the position stays live.
    const [row] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, positionP));
    expect(row.deletedAt).toBeNull();
  });

  test("deletePosition after the worker soft-deletes: succeeds", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa"]);
    const [positionP] = positionIds;

    fixtureCleanup.defer(async () => {
      await cleanup();
    });
    const workerRow = await seedLiveWorker(positionP, siteA, locA);
    actor = makeActor("superadmin", null, null);

    // The worker goes first; once it is soft-deleted the position is free.
    await db
      .update(worker)
      .set({ deletedAt: new Date() })
      .where(eq(worker.id, workerRow));

    const { deletePosition } = await import("./actions");
    const result = await deletePosition(positionP);

    expect(result.ok).toBe(true);
    const [row] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, positionP));
    expect(row.deletedAt).not.toBeNull();
  });

  test("deleteBulk splits applied and blocked across referenced positions", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa", "pb", "pc"]);
    const [referencedId, freeId, outsideId] = positionIds;

    fixtureCleanup.defer(async () => {
      await cleanup();
    });
    // A two-position worker: the batch holds neither the placeholder
    // positionId nor a single-position guess — only the pivot says which
    // positions it holds.
    await seedWorkerHolding([outsideId, referencedId], siteA, locA);
    actor = makeActor("superadmin", null, null);

    const { deleteBulk } = await import("./actions");
    const result = await deleteBulk([referencedId, freeId]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);

    const rows = await db
      .select({ id: position.id, deletedAt: position.deletedAt })
      .from(position);
    const deletedAtOf = (id: string) =>
      rows.find((row) => row.id === id)?.deletedAt;
    expect(deletedAtOf(referencedId)).toBeNull();
    expect(deletedAtOf(freeId)).not.toBeNull();
  });

  test("deleteBulk on a mixed batch: out-of-scope referenced ids are neither blocked nor applied", async () => {
    const inScope = await seedSiteWithPositions(["pa", "pb"]);
    const foreign = await seedSiteWithPositions(["pc"]);
    const [inScopeFree, inScopeReferenced] = inScope.positionIds;
    const [outOfScopeReferenced] = foreign.positionIds;

    fixtureCleanup.defer(async () => {
      await inScope.cleanup();
      await foreign.cleanup();
    });
    await seedLiveWorker(inScopeReferenced, inScope.siteA, inScope.locA);
    await seedLiveWorker(
      outOfScopeReferenced,
      foreign.siteA,
      foreign.locA,
    );
    // The ho of site A must never learn whether a foreign position holds
    // workers: the foreign id is dropped before any counting happens.
    actor = makeActor("ho", inScope.siteA, null);

    const { deleteBulk } = await import("./actions");
    const result = await deleteBulk([
      inScopeFree,
      inScopeReferenced,
      outOfScopeReferenced,
    ]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);

    const rows = await db
      .select({ id: position.id, deletedAt: position.deletedAt })
      .from(position);
    const deletedAtOf = (id: string) =>
      rows.find((row) => row.id === id)?.deletedAt;
    expect(deletedAtOf(inScopeFree)).not.toBeNull();
    expect(deletedAtOf(inScopeReferenced)).toBeNull();
    expect(deletedAtOf(outOfScopeReferenced)).toBeNull();
  });

  test("superadmin deletes a worker-free position: ok", async () => {
    const { positionIds, cleanup } = await seedSiteWithPositions(["pf"]);
    const [freeId] = positionIds;

    fixtureCleanup.defer(async () => {
      await cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const { deletePosition } = await import("./actions");
    const result = await deletePosition(freeId);

    expect(result.ok).toBe(true);
    const [row] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, freeId));
    expect(row.deletedAt).not.toBeNull();
  });
  test("a worker holding the position among several blocks the delete", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa", "pb"]);
    const [firstId, secondId] = positionIds;

    fixtureCleanup.defer(async () => {
      await cleanup();
    });
    // The placeholder carries the first id; the second is held only
    // through the pivot.
    await seedWorkerHolding([firstId, secondId], siteA, locA);
    actor = makeActor("superadmin", null, null);

    const { deletePosition } = await import("./actions");
    const result = await deletePosition(secondId);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Some workers still reference this position");

    const [row] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, secondId));
    expect(row.deletedAt).toBeNull();
  });

  test("soft-deleted worker does not block the position delete", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa"]);

    fixtureCleanup.defer(async () => {
      await cleanup();
    });
    const [positionId] = positionIds;
    const workerId = await seedLiveWorker(positionId, siteA, locA);
    // Soft delete only flips worker.deleted_at: its pivot row stays.
    await db
      .update(worker)
      .set({ deletedAt: new Date() })
      .where(eq(worker.id, workerId));
    actor = makeActor("superadmin", null, null);

    const { deletePosition } = await import("./actions");
    const result = await deletePosition(positionId);

    expect(result.ok).toBe(true);
    const [row] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, positionId));
    expect(row.deletedAt).not.toBeNull();
  });
});
