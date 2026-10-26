import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  position,
  site,
  siteLocation,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The work-area actions resolve their actor through requireUser — swapped
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

// Site A holds the work area and its admissible positions; site B holds a
// foreign position the weld must reject. No user row is needed: the actor
// is the requireUser stub itself (bound-guard.test pattern).
async function seedWorkAreaWithAreaPositions(areaPositionNames: string[]) {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locA = randomUUID();
  const workAreaId = randomUUID();

  await db.insert(site).values([
    { id: siteA, name: `t4-wap-s-a-${siteA}` },
    { id: siteB, name: `t4-wap-s-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values({
    id: locA,
    siteId: siteA,
    name: `t4-wap-loc-${locA}`,
  });
  await db.insert(workArea).values({
    id: workAreaId,
    siteLocationId: locA,
    siteId: siteA,
    name: "T4 WAP Area",
  });
  const areaPositionIds = areaPositionNames.map(() => randomUUID());
  await db.insert(position).values(
    areaPositionNames.map((name, index) => ({
      id: areaPositionIds[index],
      siteId: siteA,
      name: `t4-wap-${name}`,
    })),
  );

  const foreignPositionId = randomUUID();
  await db.insert(position).values({
    id: foreignPositionId,
    siteId: siteB,
    name: "t4-wap-foreign",
  });

  const seedAreaPivot = async (positionIds: string[]) => {
    await db.insert(workAreaPosition).values(
      positionIds.map((positionId) => ({
        workAreaId,
        positionId,
        siteId: siteA,
        siteLocationId: locA,
      })),
    );
  };

  const pivotIdsOf = async () =>
    (
      await db
        .select({ positionId: workAreaPosition.positionId })
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, workAreaId))
    ).map((row) => row.positionId);

  const cleanup = async () => {
    // Child-first: the pivot rows hold the RESTRICT weld FKs.
    await db.delete(workAreaPosition).where(eq(workAreaPosition.workAreaId, workAreaId));
    for (const id of [...areaPositionIds, foreignPositionId]) {
      await db.delete(position).where(eq(position.id, id));
    }
    await db.delete(workArea).where(eq(workArea.id, workAreaId));
    await db.delete(siteLocation).where(eq(siteLocation.id, locA));
    await db.delete(site).where(eq(site.id, siteA));
    await db.delete(site).where(eq(site.id, siteB));
  };

  return { siteA, siteB, locA, workAreaId, areaPositionIds, foreignPositionId, seedAreaPivot, pivotIdsOf, cleanup };
}

const superadmin: SessionUser = {
  id: randomUUID(),
  name: "T4 WAP Superadmin",
  email: `t4-wap-${randomUUID()}@shiftly.test`,
  role: "superadmin",
  siteId: null,
  siteLocationId: null,
  isActive: true,
};

describe("work-area required positions (C7 data)", () => {
  test("updateWorkArea replaces the required-position set wholesale", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa", "pb"]);
    const [pa, pb] = fx.areaPositionIds;

    try {
      await fx.seedAreaPivot([pa]);
      actor = superadmin;

      const { updateWorkArea } = await import("./actions");
      const result = await updateWorkArea(fx.workAreaId, {
        siteLocationId: fx.locA,
        name: "T4 WAP Area Renamed",
        isActive: true,
        requiredPositionIds: [pb],
      });

      expect(result.ok).toBe(true);
      // Old rows gone, new present — not merged: the set is replaced.
      expect(fx.pivotIdsOf()).resolves.toEqual([pb]);
    } finally {
      await fx.cleanup();
    }
  });

  test("an empty array clears the required-position set", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa"]);
    const [pa] = fx.areaPositionIds;

    try {
      await fx.seedAreaPivot([pa]);
      actor = superadmin;

      const { updateWorkArea } = await import("./actions");
      const result = await updateWorkArea(fx.workAreaId, {
        siteLocationId: fx.locA,
        name: "T4 WAP Area Renamed",
        isActive: true,
        requiredPositionIds: [],
      });

      expect(result.ok).toBe(true);
      expect(fx.pivotIdsOf()).resolves.toEqual([]);
    } finally {
      await fx.cleanup();
    }
  });

  test("absent requiredPositionIds leaves the pivot untouched", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa"]);
    const [pa] = fx.areaPositionIds;

    try {
      await fx.seedAreaPivot([pa]);
      actor = superadmin;

      const { updateWorkArea } = await import("./actions");
      const result = await updateWorkArea(fx.workAreaId, {
        siteLocationId: fx.locA,
        name: "T4 WAP Area Renamed",
        isActive: true,
      });

      expect(result.ok).toBe(true);
      // The absent field is "leave unchanged", never "clear".
      expect(fx.pivotIdsOf()).resolves.toEqual([pa]);
    } finally {
      await fx.cleanup();
    }
  });

  test("a foreign-site position is rejected with a requiredPositionIds field error", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa"]);
    const [pa] = fx.areaPositionIds;

    try {
      await fx.seedAreaPivot([pa]);
      actor = superadmin;

      const { updateWorkArea } = await import("./actions");
      const result = await updateWorkArea(fx.workAreaId, {
        siteLocationId: fx.locA,
        name: "T4 WAP Area Renamed",
        isActive: true,
        requiredPositionIds: [fx.foreignPositionId],
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.requiredPositionIds).toBeTruthy();
      // The refusal writes nothing: the previous set survives.
      expect(fx.pivotIdsOf()).resolves.toEqual([pa]);
    } finally {
      await fx.cleanup();
    }
  });
});

// Areas created through createWorkArea are not tracked by the fixture:
// removed child-first by name before fx.cleanup() drops the shared rows.
async function createdAreasNamed(name: string, siteLocationId: string) {
  return db
    .select({ id: workArea.id, siteId: workArea.siteId })
    .from(workArea)
    .where(and(eq(workArea.name, name), eq(workArea.siteLocationId, siteLocationId)));
}

async function dropCreatedAreas(name: string, siteLocationId: string) {
  for (const area of await createdAreasNamed(name, siteLocationId)) {
    await db.delete(workAreaPosition).where(eq(workAreaPosition.workAreaId, area.id));
    await db.delete(workArea).where(eq(workArea.id, area.id));
  }
}

describe("createWorkArea required positions", () => {
  test("writes the area and every pivot row with the area's site and location", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa", "pb"]);
    const name = `t145-created-${randomUUID()}`;

    try {
      actor = superadmin;

      const { createWorkArea } = await import("./actions");
      const result = await createWorkArea({
        siteLocationId: fx.locA,
        name,
        requiredPositionIds: fx.areaPositionIds,
      });

      expect(result.ok).toBe(true);
      const [area] = await createdAreasNamed(name, fx.locA);
      expect(area.siteId).toBe(fx.siteA);

      const pivots = await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, area.id));
      expect(pivots.map((row) => row.positionId).sort()).toEqual(
        [...fx.areaPositionIds].sort(),
      );
      for (const row of pivots) {
        expect(row.siteId).toBe(fx.siteA);
        expect(row.siteLocationId).toBe(fx.locA);
      }
    } finally {
      await dropCreatedAreas(name, fx.locA);
      await fx.cleanup();
    }
  });

  test("a foreign-site position is rejected with a field error and leaves no work area", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa"]);
    const name = `t145-foreign-${randomUUID()}`;

    try {
      actor = superadmin;

      const { createWorkArea } = await import("./actions");
      const result = await createWorkArea({
        siteLocationId: fx.locA,
        name,
        requiredPositionIds: [fx.areaPositionIds[0], fx.foreignPositionId],
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.requiredPositionIds).toBe(
        "Position must be in the same site as the location",
      );
      expect(await createdAreasNamed(name, fx.locA)).toEqual([]);
    } finally {
      await dropCreatedAreas(name, fx.locA);
      await fx.cleanup();
    }
  });

  test("an empty set is rejected before any write", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa"]);
    const name = `t145-empty-${randomUUID()}`;

    try {
      actor = superadmin;

      const { createWorkArea } = await import("./actions");
      const result = await createWorkArea({
        siteLocationId: fx.locA,
        name,
        requiredPositionIds: [],
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.requiredPositionIds).toBeTruthy();
      expect(await createdAreasNamed(name, fx.locA)).toEqual([]);
    } finally {
      await dropCreatedAreas(name, fx.locA);
      await fx.cleanup();
    }
  });

  test("a pinned admin still creates in their own location", async () => {
    const fx = await seedWorkAreaWithAreaPositions(["pa"]);
    const name = `t145-admin-${randomUUID()}`;

    try {
      actor = {
        ...superadmin,
        id: randomUUID(),
        role: "admin",
        siteId: fx.siteA,
        siteLocationId: fx.locA,
      };

      const { createWorkArea } = await import("./actions");
      const result = await createWorkArea({
        // Ignored for an admin: the pinned binding wins.
        siteLocationId: randomUUID(),
        name,
        requiredPositionIds: fx.areaPositionIds,
      });

      expect(result.ok).toBe(true);
      expect(await createdAreasNamed(name, fx.locA)).toHaveLength(1);
    } finally {
      await dropCreatedAreas(name, fx.locA);
      await fx.cleanup();
    }
  });
});
