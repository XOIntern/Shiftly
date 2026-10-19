import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { workerMutationWhere, workerOwnedByActor } from "./worker-scope";
import { position, site, siteLocation, worker } from "../drizzle/schema";

// Workers epic (#85), mirroring lib/work-area-scope.test.ts's approach —
// the ownership guard + weld for the worker table, exercised against the
// real dev DB (docker shiftly-postgres :5433).
//
// Worker ownership: superadmin unscoped, ho via worker.site_id, admin via
// worker.site_location_id — each fail closed on a null binding. Workers
// need a position of their own site to satisfy the composite
// worker_position_site_fk, so each fixture seeds one.
describe("worker scope guards", () => {
  test("superadmin owns every worker", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const posId = randomUUID();
    const workerId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t10-wscope-sa-${siteId}` });
      await db.insert(siteLocation).values({ id: locId, siteId, name: `t10-wscope-sa-loc-${locId}` });
      await db.insert(position).values({ id: posId, siteId, name: `t10-wscope-pos-${posId}` });
      await db.insert(worker).values({
        id: workerId,
        siteLocationId: locId,
        siteId,
        positionId: posId,
        employeeId: "WSA-001",
        name: "Superadmin Worker",
      });

      expect(
        await workerOwnedByActor(
          { role: "superadmin", siteId: null, siteLocationId: null },
          workerId,
        ),
      ).toBe(true);
    } finally {
      await db.delete(worker).where(eq(worker.id, workerId));
      await db.delete(position).where(eq(position.id, posId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("ho owns only workers under their site", async () => {
    const siteId = randomUUID();
    const foreignSiteId = randomUUID();
    const locId = randomUUID();
    const foreignLocId = randomUUID();
    const posId = randomUUID();
    const foreignPosId = randomUUID();
    const ownId = randomUUID();
    const foreignId = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteId, name: `t10-wscope-ho-${siteId}` },
        { id: foreignSiteId, name: `t10-wscope-hof-${foreignSiteId}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locId, siteId, name: `t10-wscope-ho-loc-${locId}` },
        { id: foreignLocId, siteId: foreignSiteId, name: `t10-wscope-hof-loc-${foreignLocId}` },
      ]);
      await db.insert(position).values([
        { id: posId, siteId, name: `t10-wscope-ho-pos-${posId}` },
        { id: foreignPosId, siteId: foreignSiteId, name: `t10-wscope-hof-pos-${foreignPosId}` },
      ]);
      await db.insert(worker).values([
        {
          id: ownId,
          siteLocationId: locId,
          siteId,
          positionId: posId,
          employeeId: "WSH-001",
          name: "Ho's Worker",
        },
        {
          id: foreignId,
          siteLocationId: foreignLocId,
          siteId: foreignSiteId,
          positionId: foreignPosId,
          employeeId: "WSH-002",
          name: "Foreign Worker",
        },
      ]);

      expect(
        await workerOwnedByActor({ role: "ho", siteId, siteLocationId: null }, ownId),
      ).toBe(true);
      expect(
        await workerOwnedByActor({ role: "ho", siteId, siteLocationId: null }, foreignId),
      ).toBe(false);
    } finally {
      await db.delete(worker).where(eq(worker.id, ownId));
      await db.delete(worker).where(eq(worker.id, foreignId));
      await db.delete(position).where(eq(position.id, posId));
      await db.delete(position).where(eq(position.id, foreignPosId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(siteLocation).where(eq(siteLocation.id, foreignLocId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(site).where(eq(site.id, foreignSiteId));
    }
  });

  test("admin owns only workers in their binding location", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const posId = randomUUID();
    const ownId = randomUUID();
    const foreignId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t10-wscope-ad-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t10-wscope-ad-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t10-wscope-ad-loc-b-${locBId}` },
      ]);
      await db.insert(position).values({ id: posId, siteId, name: `t10-wscope-ad-pos-${posId}` });
      await db.insert(worker).values([
        {
          id: ownId,
          siteLocationId: locAId,
          siteId,
          positionId: posId,
          employeeId: "WSA2-001",
          name: "Admin's Worker",
        },
        {
          id: foreignId,
          siteLocationId: locBId,
          siteId,
          positionId: posId,
          employeeId: "WSA2-002",
          name: "Other Location Worker",
        },
      ]);

      expect(
        await workerOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: locAId },
          ownId,
        ),
      ).toBe(true);
      expect(
        await workerOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: locAId },
          foreignId,
        ),
      ).toBe(false);
    } finally {
      await db.delete(worker).where(eq(worker.id, ownId));
      await db.delete(worker).where(eq(worker.id, foreignId));
      await db.delete(position).where(eq(position.id, posId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("unbound admin owns nothing", async () => {
    // No row exists at all: worker.site_location_id is NOT NULL, so an
    // unbound admin can never match either way.
    const siteId = randomUUID();
    const locId = randomUUID();
    const posId = randomUUID();
    const workerId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t10-wscope-unb-${siteId}` });
      await db.insert(siteLocation).values({ id: locId, siteId, name: `t10-wscope-unb-loc-${locId}` });
      await db.insert(position).values({ id: posId, siteId, name: `t10-wscope-unb-pos-${posId}` });
      await db.insert(worker).values({
        id: workerId,
        siteLocationId: locId,
        siteId,
        positionId: posId,
        employeeId: "WSU-001",
        name: "Unbound Target",
      });

      expect(
        await workerOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: null },
          workerId,
        ),
      ).toBe(false);
    } finally {
      await db.delete(worker).where(eq(worker.id, workerId));
      await db.delete(position).where(eq(position.id, posId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("workerMutationWhere welds the admin binding: foreign row untouched", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const posId = randomUUID();
    const workerId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t10-wscope-weld-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t10-wscope-weld-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t10-wscope-weld-loc-b-${locBId}` },
      ]);
      await db.insert(position).values({ id: posId, siteId, name: `t10-wscope-weld-pos-${posId}` });
      await db.insert(worker).values({
        id: workerId,
        siteLocationId: locBId, // foreign to the admin
        siteId,
        positionId: posId,
        employeeId: "WSW-001",
        name: "Foreign Worker",
      });
      const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };

      const renamed = await db
        .update(worker)
        .set({ name: "Hijacked" })
        .where(workerMutationWhere(admin, workerId))
        .returning({ id: worker.id });
      expect(renamed).toHaveLength(0);

      const [row] = await db.select().from(worker).where(eq(worker.id, workerId));
      expect(row).toBeTruthy();
      expect(row.siteLocationId).toBe(locBId);
      expect(row.name).toBe("Foreign Worker");
      expect(row.isActive).toBe(true);
    } finally {
      await db.delete(worker).where(eq(worker.id, workerId));
      await db.delete(position).where(eq(position.id, posId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
