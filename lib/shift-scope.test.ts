import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { shiftMutationWhere, shiftOwnedByActor } from "./shift-scope";
import { site, siteLocation, shiftDefinition } from "../drizzle/schema";

// Shift definitions (Module 3, mp-requests epic): the ownership guard +
// weld for the shift_definition table, mirroring lib/work-area-scope.test.ts
// — the seam the server actions call, exercised against the real dev DB.
//
// Shift ownership: superadmin unscoped, ho via shift_definition.site_id,
// admin via shift_definition.site_location_id — each fail closed on a null
// binding. The weld always excludes soft-deleted rows.
async function seedShift(args: {
  siteId: string;
  siteLocationId: string;
  id?: string;
  label?: string;
  orderIndex?: number;
}) {
  const id = args.id ?? randomUUID();
  await db.insert(shiftDefinition).values({
    id,
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    label: args.label ?? "T-Shift Scope Shift",
    orderIndex: args.orderIndex ?? 1,
    startTime: "06:00",
    endTime: "14:00",
  });
  return id;
}

async function dropShift(id: string) {
  await db.delete(shiftDefinition).where(eq(shiftDefinition.id, id));
}

describe("shift ownership guard", () => {
  test("admin bound to location A does not own a shift under location B", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t-shift-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t-shift-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t-shift-loc-b-${locBId}` },
      ]);
      const shiftId = await seedShift({
        siteId,
        siteLocationId: locBId, // foreign to the admin
        orderIndex: 1,
      });

      expect(
        await shiftOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: locAId },
          shiftId,
        ),
      ).toBe(false);

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row).toBeTruthy();
      expect(row.siteLocationId).toBe(locBId);
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).toBeNull();

      await dropShift(shiftId);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: admin owns a shift under their own location; ho owns one under their own site", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const adminShiftId = randomUUID();
    const hoShiftId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t-shift-site-${siteId}` });
      await db
        .insert(siteLocation)
        .values({ id: locId, siteId, name: `t-shift-loc-${locId}` });
      await seedShift({
        siteId,
        siteLocationId: locId,
        id: adminShiftId,
        orderIndex: 1,
        label: "T-Shift Admin Shift",
      });
      await seedShift({
        siteId,
        siteLocationId: locId,
        id: hoShiftId,
        orderIndex: 2,
        label: "T-Shift Ho Shift",
      });

      expect(
        await shiftOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: locId },
          adminShiftId,
        ),
      ).toBe(true);
      expect(
        await shiftOwnedByActor({ role: "ho", siteId, siteLocationId: null }, hoShiftId),
      ).toBe(true);
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, adminShiftId));
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, hoShiftId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("superadmin stays unscoped; unbound admin and unbound ho are denied", async () => {
    const shiftId = randomUUID(); // no row exists at all
    expect(
      await shiftOwnedByActor(
        { role: "superadmin", siteId: null, siteLocationId: null },
        shiftId,
      ),
    ).toBe(true);
    // shift_definition.site_location_id is NOT NULL: an unbound admin can
    // never match.
    expect(
      await shiftOwnedByActor(
        { role: "admin", siteId: null, siteLocationId: null },
        shiftId,
      ),
    ).toBe(false);
    // shift_definition.site_id is NOT NULL: an unbound ho can never match either.
    expect(
      await shiftOwnedByActor({ role: "ho", siteId: null, siteLocationId: null }, shiftId),
    ).toBe(false);
  });

  test("a soft-deleted shift is owned by no one (except superadmin)", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const shiftId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t-shift-site-${siteId}` });
      await db
        .insert(siteLocation)
        .values({ id: locId, siteId, name: `t-shift-loc-${locId}` });
      await seedShift({
        siteId,
        siteLocationId: locId,
        id: shiftId,
        orderIndex: 1,
      });
      // Seed a soft-delete directly — the actions do the same thing.
      await db
        .update(shiftDefinition)
        .set({ deletedAt: new Date() })
        .where(eq(shiftDefinition.id, shiftId));

      expect(
        await shiftOwnedByActor({ role: "superadmin", siteId: null, siteLocationId: null }, shiftId),
      ).toBe(true);
      expect(
        await shiftOwnedByActor({ role: "ho", siteId, siteLocationId: null }, shiftId),
      ).toBe(false);
      expect(
        await shiftOwnedByActor(
          { role: "admin", siteId: null, siteLocationId: locId },
          shiftId,
        ),
      ).toBe(false);
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});

describe("shift ownership weld", () => {
  test("foreign-location admin: welded update/delete probes touch nothing", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const shiftId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t-shift-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t-shift-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t-shift-loc-b-${locBId}` },
      ]);
      await seedShift({
        siteId,
        siteLocationId: locBId,
        id: shiftId,
        orderIndex: 1,
        label: "T-Shift Foreign Shift",
      });
      const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };

      const probe = await db.transaction(async (tx) => {
        const renamed = await tx
          .update(shiftDefinition)
          .set({ label: "Hijacked" })
          .where(shiftMutationWhere(admin, shiftId))
          .returning({ id: shiftDefinition.id });
        const deleted = await tx
          .delete(shiftDefinition)
          .where(shiftMutationWhere(admin, shiftId))
          .returning({ id: shiftDefinition.id });
        return { renamed, deleted };
      });

      expect(probe.renamed).toHaveLength(0);
      expect(probe.deleted).toHaveLength(0);

      const [row] = await db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row).toBeTruthy();
      expect(row.siteLocationId).toBe(locBId);
      expect(row.label).toBe("T-Shift Foreign Shift");
      expect(row.deletedAt).toBeNull();
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("unbound admin: the welded WHERE fails closed even against an existing row", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const shiftId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t-shift-site-${siteId}` });
      await db
        .insert(siteLocation)
        .values({ id: locId, siteId, name: `t-shift-loc-${locId}` });
      await seedShift({
        siteId,
        siteLocationId: locId,
        id: shiftId,
        orderIndex: 1,
      });

      const renamed = await db
        .update(shiftDefinition)
        .set({ label: "Hijacked" })
        .where(
          shiftMutationWhere(
            { role: "admin", siteId: null, siteLocationId: null },
            shiftId,
          ),
        )
        .returning({ id: shiftDefinition.id });
      expect(renamed).toHaveLength(0);
      const [row] = await db
        .select({ label: shiftDefinition.label })
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, shiftId));
      expect(row.label).toBe("T-Shift Scope Shift");
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("positive control: the weld lets an ho rename/soft-delete under their own site", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const shiftId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `t-shift-site-${siteId}` });
      await db
        .insert(siteLocation)
        .values({ id: locId, siteId, name: `t-shift-loc-${locId}` });
      await seedShift({
        siteId,
        siteLocationId: locId,
        id: shiftId,
        orderIndex: 1,
        label: "T-Shift Ho Weld",
      });
      const ho = { role: "ho" as const, siteId, siteLocationId: null };

      const probe = await db.transaction(async (tx) => {
        const renamed = await tx
          .update(shiftDefinition)
          .set({ label: "T-Shift Ho Weld Renamed" })
          .where(shiftMutationWhere(ho, shiftId))
          .returning({ id: shiftDefinition.id });
        // Soft-delete is the delete path the actions take; the weld rides
        // inside it the same way.
        const softDeleted = await tx
          .update(shiftDefinition)
          .set({ deletedAt: new Date() })
          .where(shiftMutationWhere(ho, shiftId))
          .returning({ deletedAt: shiftDefinition.deletedAt });
        // Nothing else matches once deleted: the weld's isNull guard holds.
        const again = await tx
          .update(shiftDefinition)
          .set({ label: "T-Shift Ho Weld Again" })
          .where(shiftMutationWhere(ho, shiftId))
          .returning({ id: shiftDefinition.id });
        return { renamed, softDeleted, again };
      });

      expect(probe.renamed).toHaveLength(1);
      expect(probe.softDeleted).toHaveLength(1);
      expect(probe.softDeleted[0].deletedAt).not.toBeNull();
      expect(probe.again).toHaveLength(0);
    } finally {
      await db.delete(shiftDefinition).where(eq(shiftDefinition.id, shiftId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
