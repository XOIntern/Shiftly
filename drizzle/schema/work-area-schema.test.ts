import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { site, siteLocation } from "./site-schema";
import { position } from "./position-schema";
import { workArea, workAreaPosition } from "./work-area-schema";

// DB-level pins for work_area_position (roster spec §3.1, C7 activation):
// the (work_area_id, position_id) PK rejects a duplicate pair (23505), the
// triple weld to work_area pins the area into the SAME site (23503), and
// the (position_id, site_id) weld pins the position into the same site
// (23503). Fixtures prefixed t-mp- (same convention as this directory) and
// cleaned up FK-safely after each run.

let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdPositionIds: string[] = [];
const createdWorkAreaIds: string[] = [];
const createdWorkAreaPositionIds: string[] = [];

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-roster-${run}-site-${tag}-${siteId}`,
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
    name: `t-roster-${run}-loc-${tag}-${locationId}`,
  });
  return locationId;
}

interface BaseFixture {
  siteId: string;
  locationId: string;
}

async function createBase(run: string, tag: string): Promise<BaseFixture> {
  const siteId = await createSite(run, tag);
  const locationId = await createLocation(run, tag, siteId);
  return { siteId, locationId };
}

async function createPosition(
  run: string,
  fx: BaseFixture,
  tag: string,
): Promise<string> {
  const id = randomUUID();
  createdPositionIds.push(id);
  await db.insert(position).values({
    id,
    siteId: fx.siteId,
    name: `t-roster-pos-${tag}-${id}`,
  });
  return id;
}

async function createWorkArea(
  run: string,
  fx: BaseFixture,
  tag: string,
): Promise<string> {
  const id = randomUUID();
  createdWorkAreaIds.push(id);
  await db.insert(workArea).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    name: `t-roster-area-${tag}-${id}`,
  });
  return id;
}

afterAll(async () => {
  if (createdWorkAreaPositionIds.length > 0) {
    await db.delete(workAreaPosition).where(
      inArray(workAreaPosition.workAreaId, createdWorkAreaPositionIds),
    );
  }
  if (createdWorkAreaIds.length > 0) {
    await db.delete(workArea).where(inArray(workArea.id, createdWorkAreaIds));
  }
  if (createdPositionIds.length > 0) {
    await db
      .delete(position)
      .where(inArray(position.id, createdPositionIds));
  }
  if (createdLocationIds.length > 0) {
    await db
      .delete(siteLocation)
      .where(inArray(siteLocation.id, createdLocationIds));
  }
  if (createdSiteIds.length > 0) {
    await db.delete(site).where(inArray(site.id, createdSiteIds));
  }
});

describe("work_area_position (roster spec §3.1)", () => {
  test("t-roster-anchor: position assignment round-trips with defaults", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "a");
    const workAreaId = await createWorkArea(run, fx, "wa1");
    const positionId = await createPosition(run, fx, "p1");
    createdWorkAreaPositionIds.push(workAreaId);

    await db.insert(workAreaPosition).values({
      workAreaId,
      positionId,
      siteLocationId: fx.locationId,
      siteId: fx.siteId,
    });

    const [row] = await db
      .select()
      .from(workAreaPosition)
      .where(eq(workAreaPosition.workAreaId, workAreaId));
    expect(row).toBeTruthy();
    expect(row.positionId).toBe(positionId);
    expect(row.siteLocationId).toBe(fx.locationId);
    expect(row.siteId).toBe(fx.siteId);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("duplicate (work area, position) pair: rejected with 23505", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "b");
    const workAreaId = await createWorkArea(run, fx, "wa2");
    const positionId = await createPosition(run, fx, "p2");
    createdWorkAreaPositionIds.push(workAreaId);

    await db.insert(workAreaPosition).values({
      workAreaId,
      positionId,
      siteLocationId: fx.locationId,
      siteId: fx.siteId,
    });

    let code: string | undefined;
    try {
      await db.insert(workAreaPosition).values({
        workAreaId,
        positionId,
        siteLocationId: fx.locationId,
        siteId: fx.siteId,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, workAreaId))).length,
    ).toBe(1); // only the original assignment survived
  });

  test("weld: work area from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteA = await createSite(run, "a");
    const locA = await createLocation(run, "locA", siteA);
    const siteB = await createSite(run, "b");
    const locB = await createLocation(run, "locB", siteB);

    const fxOnA: BaseFixture = { siteId: siteA, locationId: locA };
    const positionId = await createPosition(run, fxOnA, "p3");
    const foreignAreaId = await createWorkArea(run, {
      siteId: siteB,
      locationId: locB,
    }, "foreign");
    createdWorkAreaPositionIds.push(foreignAreaId);

    let code: string | undefined;
    try {
      await db.insert(workAreaPosition).values({
        workAreaId: foreignAreaId,
        positionId,
        siteLocationId: locA,
        siteId: siteA,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, foreignAreaId))).length,
    ).toBe(0);
  });

  test("weld: position from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteA = await createSite(run, "a");
    const locA = await createLocation(run, "locA", siteA);
    const siteB = await createSite(run, "b");
    const locB = await createLocation(run, "locB", siteB);

    const fxOnA: BaseFixture = { siteId: siteA, locationId: locA };
    const workAreaId = await createWorkArea(run, fxOnA, "wa3");
    const foreignPositionId = await createPosition(run, {
      siteId: siteB,
      locationId: locB,
    }, "foreign-pos");
    createdWorkAreaPositionIds.push(workAreaId);

    let code: string | undefined;
    try {
      await db.insert(workAreaPosition).values({
        workAreaId,
        positionId: foreignPositionId,
        siteLocationId: locA,
        siteId: siteA,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, workAreaId))).length,
    ).toBe(0);
  });
});
