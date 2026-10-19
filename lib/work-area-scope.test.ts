import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import {
  workAreaMutationWhere,
  workAreaOwnedByActor,
} from "./work-area-scope";
import { site, siteLocation, workArea } from "../drizzle/schema";

// Departments & work areas epic (#60), carried past the dropped-department
// epic: the ownership guard + weld for the work_area table, mirroring
// lib/location-fk.test.ts's approach — the seam the server actions call,
// exercised against the real dev DB (docker shiftly-postgres :5433).
//
// Work-area ownership: superadmin unscoped, ho via work_area.site_id, admin
// via work_area.site_location_id — each fail closed on a null binding.
describe("work-area ownership guard", () => {
  test("admin bound to location A does not own a work area under location B", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `wa-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `wa-loc-a-${locAId}` },
        { id: locBId, siteId, name: `wa-loc-b-${locBId}` },
      ]);
      await db.insert(workArea).values({
        id: workAreaId,
        siteLocationId: locBId, // foreign to the admin
        siteId,
        name: "Foreign Area",
      });

      expect(
        await workAreaOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: locAId },
          workAreaId,
        ),
      ).toBe(false);

      const [row] = await db.select().from(workArea).where(eq(workArea.id, workAreaId));
      expect(row).toBeTruthy();
      expect(row.siteLocationId).toBe(locBId);
      expect(row.isActive).toBe(true);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: admin owns a work area under their own location; ho owns one under their own site", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const waAId = randomUUID();
    const waBId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `wa-site-own-${siteId}` });
      await db.insert(siteLocation).values({ id: locId, siteId, name: `wa-loc-own-${locId}` });
      await db.insert(workArea).values([
        { id: waAId, siteLocationId: locId, siteId, name: "Admin's Area" },
        { id: waBId, siteLocationId: locId, siteId, name: "Ho's Area" },
      ]);

      expect(
        await workAreaOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: locId },
          waAId,
        ),
      ).toBe(true);
      expect(
        await workAreaOwnedByActor({ role: "ho", siteId, siteLocationId: null }, waBId),
      ).toBe(true);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, waAId));
      await db.delete(workArea).where(eq(workArea.id, waBId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("superadmin stays unscoped; unbound admin and unbound ho are denied", async () => {
    const workAreaId = randomUUID(); // no row exists at all
    expect(
      await workAreaOwnedByActor(
        { role: "superadmin", siteId: null, siteLocationId: null },
        workAreaId,
      ),
    ).toBe(true);
    // work_area.site_location_id is NOT NULL: an unbound admin can never match.
    expect(
      await workAreaOwnedByActor(
        { role: "admin", siteId: null, siteLocationId: null },
        workAreaId,
      ),
    ).toBe(false);
    // work_area.site_id is NOT NULL: an unbound ho can never match either.
    expect(
      await workAreaOwnedByActor({ role: "ho", siteId: null, siteLocationId: null }, workAreaId),
    ).toBe(false);
  });
});

describe("work-area ownership weld", () => {
  test("foreign-location admin: welded update/toggle/delete probes touch nothing", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `waweld-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `waweld-loc-a-${locAId}` },
        { id: locBId, siteId, name: `waweld-loc-b-${locBId}` },
      ]);
      await db.insert(workArea).values({
        id: workAreaId,
        siteLocationId: locBId,
        siteId,
        name: "Foreign Area",
      });
      const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };

      const probe = await db.transaction(async (tx) => {
        const renamed = await tx
          .update(workArea)
          .set({ name: "Hijacked" })
          .where(workAreaMutationWhere(admin, workAreaId))
          .returning({ id: workArea.id });
        const toggled = await tx
          .update(workArea)
          .set({ isActive: sql`not ${workArea.isActive}` })
          .where(workAreaMutationWhere(admin, workAreaId))
          .returning({ id: workArea.id });
        const deleted = await tx
          .delete(workArea)
          .where(workAreaMutationWhere(admin, workAreaId))
          .returning({ id: workArea.id });
        return { renamed, toggled, deleted };
      });

      expect(probe.renamed).toHaveLength(0);
      expect(probe.toggled).toHaveLength(0);
      expect(probe.deleted).toHaveLength(0);

      const [row] = await db.select().from(workArea).where(eq(workArea.id, workAreaId));
      expect(row).toBeTruthy();
      expect(row.siteLocationId).toBe(locBId);
      expect(row.name).toBe("Foreign Area");
      expect(row.isActive).toBe(true);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("unbound admin: the welded WHERE fails closed even against an existing row", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `waweld-unb-${siteId}` });
      await db.insert(siteLocation).values({ id: locId, siteId, name: `waweld-unb-loc-${locId}` });
      await db.insert(workArea).values({
        id: workAreaId,
        siteLocationId: locId,
        siteId,
        name: "Unbound Target",
      });

      const toggled = await db
        .update(workArea)
        .set({ isActive: sql`not ${workArea.isActive}` })
        .where(workAreaMutationWhere({ role: "admin", siteId: null, siteLocationId: null }, workAreaId))
        .returning({ id: workArea.id });
      expect(toggled).toHaveLength(0);
      const [row] = await db.select().from(workArea).where(eq(workArea.id, workAreaId));
      expect(row.isActive).toBe(true);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: the weld lets an ho toggle/delete under their own site", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `waweld-ho-${siteId}` });
      await db.insert(siteLocation).values({ id: locId, siteId, name: `waweld-ho-loc-${locId}` });
      await db.insert(workArea).values({
        id: workAreaId,
        siteLocationId: locId,
        siteId,
        name: "Ho Weld Area",
      });
      const ho = { role: "ho" as const, siteId, siteLocationId: null };

      const probe = await db.transaction(async (tx) => {
        const toggled = await tx
          .update(workArea)
          .set({ isActive: sql`not ${workArea.isActive}` })
          .where(workAreaMutationWhere(ho, workAreaId))
          .returning({ isActive: workArea.isActive });
        const deleted = await tx
          .delete(workArea)
          .where(workAreaMutationWhere(ho, workAreaId))
          .returning({ id: workArea.id });
        return { toggled, deleted };
      });

      expect(probe.toggled).toEqual([{ isActive: false }]);
      expect(probe.deleted).toHaveLength(1);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("bulk form: superadmin matches all ids, an unbound ho matches none", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const waAId = randomUUID();
    const waBId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `wabulk-${siteId}` });
      await db.insert(siteLocation).values({ id: locId, siteId, name: `wabulk-loc-${locId}` });
      await db.insert(workArea).values([
        { id: waAId, siteLocationId: locId, siteId, name: "Bulk A" },
        { id: waBId, siteLocationId: locId, siteId, name: "Bulk B" },
      ]);

      const unboundToggled = await db
        .update(workArea)
        .set({ isActive: sql`not ${workArea.isActive}` })
        .where(
          // The bulk trio: workAreaBulkMutationWhere — unbound fails closed.
          await (async () => {
            const { workAreaBulkMutationWhere } = await import("./work-area-scope");
            return workAreaBulkMutationWhere(
              { role: "ho", siteId: null, siteLocationId: null },
              [waAId, waBId],
            );
          })(),
        )
        .returning({ id: workArea.id });
      expect(unboundToggled).toHaveLength(0);

      const saToggled = await db
        .update(workArea)
        .set({ isActive: sql`not ${workArea.isActive}` })
        .where(
          await (async () => {
            const { workAreaBulkMutationWhere } = await import("./work-area-scope");
            return workAreaBulkMutationWhere(
              { role: "superadmin", siteId: null, siteLocationId: null },
              [waAId, waBId],
            );
          })(),
        )
        .returning({ id: workArea.id });
      expect(saToggled).toHaveLength(2);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, waAId));
      await db.delete(workArea).where(eq(workArea.id, waBId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
