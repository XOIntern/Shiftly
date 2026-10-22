import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { shiftDefinition } from "./shift-schema";
import { site, siteLocation } from "./site-schema";

// DB-level pins for shift_definition (Module 3): per-location shift master
// data that the MP-request lines weld onto via (id, site_location_id,
// site_id). The composite FK pins the site_location onto the SAME site as
// the denormalized site_id (cross-site insert → 23503), the partial unique
// keeps (site_location_id, order_index) free per location while a row is
// alive (23505, soft-deleted rows release their slot), both mirrored on
// lib/work-area-fk.test.ts.

let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdShiftIds: string[] = [];

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-shift-${run}-site-${tag}-${siteId}`,
  });
  return siteId;
}

async function createLocation(
  run: string,
  tag: string,
  siteId: string,
): Promise<string> {
  const locationId = randomUUID();
  createdLocationIds.push(locationId);
  await db.insert(siteLocation).values({
    id: locationId,
    siteId,
    name: `t-shift-${run}-loc-${tag}`,
  });
  return locationId;
}

function trackShift(shiftId: string): string {
  createdShiftIds.push(shiftId);
  return shiftId;
}

afterAll(async () => {
  if (createdShiftIds.length > 0) {
    await db.delete(shiftDefinition).where(
      inArray(shiftDefinition.id, createdShiftIds),
    );
  }
  if (createdLocationIds.length > 0) {
    await db.delete(siteLocation).where(
      inArray(siteLocation.id, createdLocationIds),
    );
  }
  if (createdSiteIds.length > 0) {
    await db.delete(site).where(inArray(site.id, createdSiteIds));
  }
});

describe("shift_definition (Module 3 master data)", () => {
  test("t-shift-loc fixture: shift inserts and round-trips with defaults", async () => {
    const run = `t${nextSeq()}`;
    const siteId = await createSite(run, "a");
    const locationId = await createLocation(run, "loc", siteId);
    const shiftId = trackShift(randomUUID());

    await db.insert(shiftDefinition).values({
      id: shiftId,
      siteLocationId: locationId,
      siteId,
      label: `${run}-Morning`,
      orderIndex: 1,
      startTime: "07:00",
      endTime: "15:00",
    });

    const [row] = await db
      .select()
      .from(shiftDefinition)
      .where(eq(shiftDefinition.id, shiftId));
    expect(row).toBeTruthy();
    expect(row.siteLocationId).toBe(locationId);
    expect(row.siteId).toBe(siteId);
    expect(row.label).toBe(`${run}-Morning`);
    expect(row.orderIndex).toBe(1);
    expect(row.startTime).toBe("07:00");
    expect(row.endTime).toBe("15:00");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
  });

  test("duplicate order_index on the same location: rejected with 23505", async () => {
    const run = `t${nextSeq()}`;
    const siteId = await createSite(run, "b");
    const locationId = await createLocation(run, "loc", siteId);
    const firstId = trackShift(randomUUID());
    const dupeId = randomUUID();

    await db.insert(shiftDefinition).values({
      id: firstId,
      siteLocationId: locationId,
      siteId,
      label: `${run}-First`,
      orderIndex: 2,
      startTime: "07:00",
      endTime: "15:00",
    });

    let code: string | undefined;
    try {
      await db.insert(shiftDefinition).values({
        id: dupeId,
        siteLocationId: locationId,
        siteId,
        label: `${run}-Dupe`,
        orderIndex: 2, // same location, same slot
        startTime: "23:00",
        endTime: "07:00",
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");

    // The rejected insert must have left nothing behind.
    const rows = await db
      .select()
      .from(shiftDefinition)
      .where(eq(shiftDefinition.id, dupeId));
    expect(rows).toHaveLength(0);
  });

  test("siteLocationId from another site: rejected with 23503 (weld)", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const locationBId = await createLocation(run, "loc", siteBId);
    const shiftId = randomUUID();

    let code: string | undefined;
    try {
      await db.insert(shiftDefinition).values({
        id: shiftId,
        siteLocationId: locationBId, // site B
        siteId: siteAId, // claiming site A — mismatch
        label: `${run}-Cross Site`,
        orderIndex: 1,
        startTime: "07:00",
        endTime: "15:00",
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");

    // The rejected insert must have left nothing behind.
    const rows = await db
      .select()
      .from(shiftDefinition)
      .where(eq(shiftDefinition.id, shiftId));
    expect(rows).toHaveLength(0);
  });

  test("soft-deleted shift frees its order_index slot (partial unique)", async () => {
    const run = `t${nextSeq()}`;
    const siteId = await createSite(run, "c");
    const locationId = await createLocation(run, "loc", siteId);
    const retiredId = trackShift(randomUUID());
    const reuseId = trackShift(randomUUID());

    await db.insert(shiftDefinition).values({
      id: retiredId,
      siteLocationId: locationId,
      siteId,
      label: `${run}-Retired`,
      orderIndex: 3,
      startTime: "07:00",
      endTime: "15:00",
    });
    await db
      .update(shiftDefinition)
      .set({ deletedAt: new Date() })
      .where(eq(shiftDefinition.id, retiredId));

    // Same slot, new row: allowed because the retired row is soft-deleted.
    await db.insert(shiftDefinition).values({
      id: reuseId,
      siteLocationId: locationId,
      siteId,
      label: `${run}-Reuse`,
      orderIndex: 3,
      startTime: "23:00",
      endTime: "07:00",
    });

    const [row] = await db
      .select()
      .from(shiftDefinition)
      .where(eq(shiftDefinition.id, reuseId));
    expect(row).toBeTruthy();
    expect(row.orderIndex).toBe(3);
  });
});
