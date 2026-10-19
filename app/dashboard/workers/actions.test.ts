import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { position, site, siteLocation, worker } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

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

describe("worker actions", () => {
  test("superadmin create derives site from the location: round-trips", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("superadmin", null, null);

      const { createWorker } = await import("./actions");
      const result = await createWorker({
        siteLocationId: fx.locA1,
        positionId: fx.posA,
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
      expect(row.positionId).toBe(fx.posA);
      expect(row.name).toBe("T11 Wact Worker RT");
      expect(row.contractEndDate).toBe("2027-01-31");
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).toBeNull();
    } finally {
      await db
        .delete(worker)
        .where(eq(worker.employeeId, "t11-wact-emp-rt"));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("ho create with another site's location: rejected with scope field error", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("ho", fx.siteA, null);

      const { createWorker } = await import("./actions");
      const result = await createWorker({
        siteLocationId: fx.locB,
        positionId: fx.posB,
        employeeId: "t11-wact-emp-ho",
        name: "T11 Wact Worker HO",
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
    } finally {
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("admin create is pinned to their binding location and site's positions", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("admin", null, fx.locA1);

      const { createWorker } = await import("./actions");

      // A foreign position never lands under the pinned location.
      const foreignPos = await createWorker({
        siteLocationId: fx.locB,
        positionId: fx.posB,
        employeeId: "t11-wact-emp-adm",
        name: "T11 Wact Worker Adm",
      });
      expect(foreignPos.ok).toBe(false);
      expect(foreignPos.fieldErrors?.positionId).toBe(
        "Position must be in the same site as the location",
      );

      // The location pick is overridden to the admin's binding; the site
      // of their binding's positions is what a position check runs against.
      const result = await createWorker({
        siteLocationId: fx.locB,
        positionId: fx.posA,
        employeeId: "t11-wact-emp-adm",
        name: "T11 Wact Worker Adm",
      });
      expect(result.ok).toBe(true);

      const [row] = await db
        .select()
        .from(worker)
        .where(eq(worker.employeeId, "t11-wact-emp-adm"));
      expect(row.siteLocationId).toBe(fx.locA1);
      expect(row.siteId).toBe(fx.siteA);
      expect(row.positionId).toBe(fx.posA);
    } finally {
      await db
        .delete(worker)
        .where(eq(worker.employeeId, "t11-wact-emp-adm"));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("create with a position from another site: rejected with same-site field error", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("superadmin", null, null);

      const { createWorker } = await import("./actions");
      const result = await createWorker({
        siteLocationId: fx.locA1,
        positionId: fx.posB,
        employeeId: "t11-wact-emp-xs",
        name: "T11 Wact Worker XS",
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.positionId).toBe(
        "Position must be in the same site as the location",
      );

      const rows = await db
        .select({ id: worker.id })
        .from(worker)
        .where(eq(worker.employeeId, "t11-wact-emp-xs"));
      expect(rows.length).toBe(0);
    } finally {
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("create duplicate employee_id in one location: mapped 23505 message", async () => {
    const fx = await seedGlobalData();
    const seeded = randomUUID();

    try {
      await db.insert(worker).values({
        id: seeded,
        siteLocationId: fx.locA1,
        siteId: fx.siteA,
        employeeId: "t11-wact-emp-dup",
        name: "T11 Wact Worker Dup",
        positionId: fx.posA,
      });

      actor = makeActor("superadmin", null, null);

      const { createWorker } = await import("./actions");
      const result = await createWorker({
        siteLocationId: fx.locA1,
        positionId: fx.posA,
        employeeId: "t11-wact-emp-dup",
        name: "T11 Wact Worker Dup II",
      });

      expect(result.ok).toBe(false);
      expect(result.message).toBe("Employee ID already in use in this location");

      // The uniqueness is per location: another location still accepts it.
      const otherLoc = await createWorker({
        siteLocationId: fx.locA2,
        positionId: fx.posA,
        employeeId: "t11-wact-emp-dup",
        name: "T11 Wact Worker Dup III",
      });
      expect(otherLoc.ok).toBe(true);
    } finally {
      await db
        .delete(worker)
        .where(eq(worker.employeeId, "t11-wact-emp-dup"));
      await db
        .delete(worker)
        .where(eq(worker.name, "T11 Wact Worker Dup II"));
      await db
        .delete(worker)
        .where(eq(worker.name, "T11 Wact Worker Dup III"));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("ho update to another site's location: rejected with scope field error", async () => {
    const fx = await seedGlobalData();
    const wid = randomUUID();

    try {
      await db.insert(worker).values({
        id: wid,
        siteLocationId: fx.locA1,
        siteId: fx.siteA,
        employeeId: "t11-wact-emp-umov",
        name: "T11 Wact Worker UMov",
        positionId: fx.posA,
      });

      actor = makeActor("ho", fx.siteA, null);

      const { updateWorker } = await import("./actions");
      const result = await updateWorker(wid, {
        siteLocationId: fx.locB,
        positionId: fx.posB,
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
      expect(row.positionId).toBe(fx.posA);
      expect(row.contractEndDate).toBeNull();
    } finally {
      await db.delete(worker).where(eq(worker.id, wid));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("superadmin update moves the worker across sites and positions", async () => {
    const fx = await seedGlobalData();
    const wid = randomUUID();

    try {
      await db.insert(worker).values({
        id: wid,
        siteLocationId: fx.locA1,
        siteId: fx.siteA,
        employeeId: "t11-wact-emp-mov",
        name: "T11 Wact Worker Mov",
        positionId: fx.posA,
        contractEndDate: "2027-06-30",
      });

      actor = makeActor("superadmin", null, null);

      const { updateWorker } = await import("./actions");
      const result = await updateWorker(wid, {
        siteLocationId: fx.locB,
        positionId: fx.posB,
        employeeId: "t11-wact-emp-mov",
        name: "T11 Wact Worker Moved",
        contractEndDate: "2028-06-30",
        isActive: false,
      });

      expect(result.ok).toBe(true);

      // Site, location and position move together — the site is derived
      // from the new location, so the composite FK pairing is consistent.
      const [row] = await db.select().from(worker).where(eq(worker.id, wid));
      expect(row.siteId).toBe(fx.siteB);
      expect(row.siteLocationId).toBe(fx.locB);
      expect(row.positionId).toBe(fx.posB);
      expect(row.name).toBe("T11 Wact Worker Moved");
      expect(row.contractEndDate).toBe("2028-06-30");
      expect(row.isActive).toBe(false);
    } finally {
      await db.delete(worker).where(eq(worker.id, wid));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("update with inactive position: succeeds", async () => {
    const fx = await seedGlobalData();
    const inactivePos = randomUUID();
    const wid = randomUUID();

    try {
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
        positionId: fx.posA,
      });

      actor = makeActor("superadmin", null, null);

      const { updateWorker } = await import("./actions");
      const result = await updateWorker(wid, {
        siteLocationId: fx.locA1,
        positionId: inactivePos,
        employeeId: "t11-wact-emp-inact",
        name: "T11 Wact Worker Inact",
        isActive: true,
      });

      // An inactive position is accepted server-side: an edit that does
      // not touch the position must never fail because it was deactivated
      // since the picker snapshot.
      expect(result.ok).toBe(true);
      const [row] = await db.select().from(worker).where(eq(worker.id, wid));
      expect(row.positionId).toBe(inactivePos);
    } finally {
      await db.delete(worker).where(eq(worker.id, wid));
      await db.delete(position).where(eq(position.id, inactivePos));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("move onto duplicate employee_id in target location: 23505 mapped", async () => {
    const fx = await seedGlobalData();
    const w1 = randomUUID();
    const w2 = randomUUID();

    try {
      // Both rows carry the same employee_id in DIFFERENT locations, which
      // the per-location unique index allows — until w2 moves onto w1's.
      await db.insert(worker).values([
        {
          id: w1,
          siteLocationId: fx.locA1,
          siteId: fx.siteA,
          employeeId: "t11-wact-emp-mdup",
          name: "T11 Wact Worker MDup 1",
          positionId: fx.posA,
        },
        {
          id: w2,
          siteLocationId: fx.locA2,
          siteId: fx.siteA,
          employeeId: "t11-wact-emp-mdup",
          name: "T11 Wact Worker MDup 2",
          positionId: fx.posA,
        },
      ]);

      actor = makeActor("superadmin", null, null);

      const { updateWorker } = await import("./actions");
      const result = await updateWorker(w2, {
        siteLocationId: fx.locA1,
        positionId: fx.posA,
        employeeId: "t11-wact-emp-mdup",
        name: "T11 Wact Worker MDup 2",
        isActive: true,
      });

      expect(result.ok).toBe(false);
      expect(result.message).toBe("Employee ID already in use in this location");

      // The move is refused: w2 keeps its own location.
      const [row] = await db.select().from(worker).where(eq(worker.id, w2));
      expect(row.siteLocationId).toBe(fx.locA2);
    } finally {
      await db.delete(worker).where(eq(worker.id, w1));
      await db.delete(worker).where(eq(worker.id, w2));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("toggle and delete weld the scope: foreign worker answers not found", async () => {
    const fx = await seedGlobalData();
    const wid = randomUUID();

    try {
      await db.insert(worker).values({
        id: wid,
        siteLocationId: fx.locB,
        siteId: fx.siteB,
        employeeId: "t11-wact-emp-fn",
        name: "T11 Wact Worker FN",
        positionId: fx.posB,
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
    } finally {
      await db.delete(worker).where(eq(worker.id, wid));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("delete frees the employee_id in the location", async () => {
    const fx = await seedGlobalData();

    try {
      actor = makeActor("superadmin", null, null);

      const { createWorker, toggleWorker, deleteWorker } =
        await import("./actions");
      const created = await createWorker({
        siteLocationId: fx.locA1,
        positionId: fx.posA,
        employeeId: "t11-wact-emp-free",
        name: "T11 Wact Worker Free",
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
        positionId: fx.posA,
        employeeId: "t11-wact-emp-free",
        name: "T11 Wact Worker Free II",
      });
      expect(reCreated.ok).toBe(true);
    } finally {
      await db
        .delete(worker)
        .where(eq(worker.employeeId, "t11-wact-emp-free"));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });

  test("bulk actions apply only in-scope ids", async () => {
    const fx = await seedGlobalData();
    const wA1 = randomUUID();
    const wA2 = randomUUID();
    const wB1 = randomUUID();

    try {
      await db.insert(worker).values([
        {
          id: wA1,
          siteLocationId: fx.locA1,
          siteId: fx.siteA,
          employeeId: "t11-wact-emp-b1",
          name: "T11 Wact Worker B1",
          positionId: fx.posA,
        },
        {
          id: wA2,
          siteLocationId: fx.locA2,
          siteId: fx.siteA,
          employeeId: "t11-wact-emp-b2",
          name: "T11 Wact Worker B2",
          positionId: fx.posA,
        },
        {
          id: wB1,
          siteLocationId: fx.locB,
          siteId: fx.siteB,
          employeeId: "t11-wact-emp-b3",
          name: "T11 Wact Worker B3",
          positionId: fx.posB,
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
    } finally {
      await db.delete(worker).where(eq(worker.id, wA1));
      await db.delete(worker).where(eq(worker.id, wA2));
      await db.delete(worker).where(eq(worker.id, wB1));
      await db.delete(position).where(eq(position.id, fx.posA));
      await db.delete(position).where(eq(position.id, fx.posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locA2));
      await db.delete(siteLocation).where(eq(siteLocation.id, fx.locB));
      await db.delete(site).where(eq(site.id, fx.siteA));
      await db.delete(site).where(eq(site.id, fx.siteB));
    }
  });
});
