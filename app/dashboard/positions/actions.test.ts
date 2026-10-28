import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  position,
  site,
  siteLocation,
  workArea,
  workAreaPosition,
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

// Seeds one site with a live location, a position, and a live work area the
// pivot can weld to. The area's required-position row is attached on top.
async function seedPositionWithWorkArea() {
  const siteA = randomUUID();
  const locA = randomUUID();
  const positionId = randomUUID();
  const workAreaId = randomUUID();

  await db.insert(site).values([{ id: siteA, name: `t4-pos-s-a-${siteA}` }]);
  await db.insert(siteLocation).values({
    id: locA,
    siteId: siteA,
    name: `t4-pos-loc-${locA}`,
  });
  await db.insert(position).values({
    id: positionId,
    siteId: siteA,
    name: "t4-pos-p",
  });
  await db.insert(workArea).values({
    id: workAreaId,
    siteLocationId: locA,
    siteId: siteA,
    name: "T4 POS Area",
  });

  const seedAreaRequirement = async () => {
    await db.insert(workAreaPosition).values({
      workAreaId,
      positionId,
      siteId: siteA,
      siteLocationId: locA,
    });
  };

  const cleanup = async () => {
    // Child-first: the pivot rows hold the RESTRICT weld FKs.
    await db.delete(workAreaPosition).where(eq(workAreaPosition.positionId, positionId));
    await db.delete(position).where(eq(position.id, positionId));
    await db.delete(workArea).where(eq(workArea.id, workAreaId));
    await db.delete(siteLocation).where(eq(siteLocation.id, locA));
    await db.delete(site).where(eq(site.id, siteA));
  };

  return { siteA, locA, positionId, workAreaId, seedAreaRequirement, cleanup };
}

const superadmin: SessionUser = {
  id: randomUUID(),
  name: "T4 POS Superadmin",
  email: `t4-pos-${randomUUID()}@shiftly.test`,
  role: "superadmin",
  siteId: null,
  siteLocationId: null,
  isActive: true,
};

describe("position delete guard against work-area requirements", () => {
  test("deletePosition is refused while a work-area pivot row references it", async () => {
    const fx = await seedPositionWithWorkArea();

    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await fx.seedAreaRequirement();
    actor = superadmin;

    const { deletePosition } = await import("./actions");
    const result = await deletePosition(fx.positionId);

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Position is still required by a work area");

    // The refusal writes nothing: the position stays live.
    const [row] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, fx.positionId));
    expect(row.deletedAt).toBeNull();
  });

  test("deletePosition succeeds once the work-area pivot row is removed", async () => {
    const fx = await seedPositionWithWorkArea();

    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    await fx.seedAreaRequirement();
    actor = superadmin;

    // Remove the requirement for the area — the row was the only block.
    await db
      .delete(workAreaPosition)
      .where(
        eq(workAreaPosition.positionId, fx.positionId),
      );

    const { deletePosition } = await import("./actions");
    const result = await deletePosition(fx.positionId);

    expect(result.ok).toBe(true);
    const [row] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, fx.positionId));
    expect(row.deletedAt).not.toBeNull();
  });

  test("deleteBulk blocks the area-required position but frees the rest", async () => {
    // Extra worker-free position for the applied side of the split.
    const fx = await seedPositionWithWorkArea();
    const freeId = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, freeId));
      await fx.cleanup();
    });
    await db.insert(position).values({
      id: freeId,
      siteId: fx.siteA,
      name: "t4-pos-free",
    });
    await fx.seedAreaRequirement();
    actor = superadmin;

    const { deleteBulk } = await import("./actions");
    const result = await deleteBulk([fx.positionId, freeId]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);

    const rows = await db
      .select({ id: position.id, deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.siteId, fx.siteA));
    const deletedAtOf = (id: string) =>
      rows.find((row) => row.id === id)?.deletedAt;
    expect(deletedAtOf(fx.positionId)).toBeNull();
    expect(deletedAtOf(freeId)).not.toBeNull();
  });
});
