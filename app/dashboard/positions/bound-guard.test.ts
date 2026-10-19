import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { position, site, siteLocation, worker } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

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
mock.module("next/cache", () => ({
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
    await db.delete(worker).where(eq(worker.siteId, siteA));
    for (const id of positionIds) {
      await db.delete(position).where(eq(position.id, id));
    }
    await db.delete(siteLocation).where(eq(siteLocation.id, locA));
    await db.delete(site).where(eq(site.id, siteA));
  };
  return { siteA, locA, positionIds, cleanup };
}

async function seedLiveWorker(positionId: string, siteId: string, locId: string) {
  const [row] = await db
    .insert(worker)
    .values({
      siteLocationId: locId,
      siteId,
      employeeId: `t12-wbg-${randomUUID()}`,
      name: "T12 WBG Worker",
      positionId,
    })
    .returning({ id: worker.id });
  return row.id;
}

describe("position bound-guard", () => {
  test("deletePosition with a live worker: blocked with the worker message", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa"]);
    const [positionP] = positionIds;

    try {
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
    } finally {
      await cleanup();
    }
  });

  test("deletePosition after the worker soft-deletes: succeeds", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa"]);
    const [positionP] = positionIds;

    try {
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
    } finally {
      await cleanup();
    }
  });

  test("deleteBulk splits applied and blocked across referenced positions", async () => {
    const { siteA, locA, positionIds, cleanup } =
      await seedSiteWithPositions(["pa", "pb"]);
    const [referencedId, freeId] = positionIds;

    try {
      await seedLiveWorker(referencedId, siteA, locA);
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
    } finally {
      await cleanup();
    }
  });

  test("superadmin deletes a worker-free position: ok", async () => {
    const { positionIds, cleanup } = await seedSiteWithPositions(["pf"]);
    const [freeId] = positionIds;

    try {
      actor = makeActor("superadmin", null, null);

      const { deletePosition } = await import("./actions");
      const result = await deletePosition(freeId);

      expect(result.ok).toBe(true);
      const [row] = await db
        .select({ deletedAt: position.deletedAt })
        .from(position)
        .where(eq(position.id, freeId));
      expect(row.deletedAt).not.toBeNull();
    } finally {
      await cleanup();
    }
  });
});
