import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode, pgErrorConstraint } from "../../error/db-errors";
import { user } from "./auth-schema";
import { site, siteLocation } from "./site-schema";
import { workArea, workAreaPosition } from "./work-area-schema";
import { position } from "./position-schema";
import { shiftDefinition } from "./shift-schema";
import {
  mpRequest,
  mpRequestLine,
} from "./mp-request-schema";

// DB-level pins for mp_request / mp_request_line (Module 3, spec §4.2–4.3):
// the exactly-one-anchor CHECK with the Monday dow rule, the open-status
// partial uniques (rejected/fulfilled frees the week slot), the site weld
// on (site_location_id, site_id), the line's triple-welded composite FKs
// to work_area and shift_definition, the position dimension (NOT NULL,
// welded to the site and to the area's required-position set — even a
// direct insert cannot pair an off-set or cross-site position), and the
// headcount CHECK. Fixtures are prefixed t-mp- and cleaned up after each
// run.

// Anchors: 2026-01-05 is a Monday, 2026-01-06 the following Tuesday.
const MONDAY = "2026-01-05";
const TUESDAY = "2026-01-06";

let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdWorkAreaIds: string[] = [];
const createdPositionIds: string[] = [];
const createdShiftIds: string[] = [];
const createdRequestIds: string[] = [];
const createdLineIds: string[] = [];

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-mp-${run}-site-${tag}-${siteId}`,
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
    name: `t-mp-${run}-loc-${tag}-${locationId}`,
  });
  return locationId;
}

const createdUserIds: string[] = [];

// The admin who "entered" the request. user.id is a text PK (auth.js), so
// created_by is text — the FK type must match.
async function createUser(run: string): Promise<string> {
  const id = randomUUID();
  createdUserIds.push(id);
  await db.insert(user).values({
    id,
    name: `t-mp-${run}-admin`,
    email: `t-mp-${run}-${id}@shiftly.test`,
  });
  return id;
}

interface BaseFixture {
  siteId: string;
  locationId: string;
  adminId: string;
}

async function createBase(run: string, tag: string): Promise<BaseFixture> {
  const siteId = await createSite(run, tag);
  const locationId = await createLocation(run, tag, siteId);
  const adminId = await createUser(run);
  return { siteId, locationId, adminId };
}

async function createWorkArea(
  fx: BaseFixture,
  tag: string,
): Promise<string> {
  const id = randomUUID();
  createdWorkAreaIds.push(id);
  await db.insert(workArea).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    name: `t-mp-area-${tag}-${id}`,
  });
  return id;
}

async function createShift(fx: BaseFixture, orderIndex: number): Promise<string> {
  const id = randomUUID();
  createdShiftIds.push(id);
  await db.insert(shiftDefinition).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    label: `t-mp-shift-${orderIndex}-${id}`,
    orderIndex,
    startTime: "07:00",
    endTime: "15:00",
  });
  return id;
}

async function createPosition(
  fx: BaseFixture,
  tag: string,
): Promise<string> {
  const id = randomUUID();
  createdPositionIds.push(id);
  await db.insert(position).values({
    id,
    siteId: fx.siteId,
    name: `t-mp-pos-${tag}-${id}`,
  });
  return id;
}

async function createPivot(
  fx: BaseFixture,
  workAreaId: string,
  positionId: string,
): Promise<void> {
  await db.insert(workAreaPosition).values({
    workAreaId,
    positionId,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
  });
}

interface RequestRowArgs {
  type: "weekly" | "daily";
  weekStart?: string;
  requestDate?: string;
  status?: "submitted" | "received" | "processing" | "fulfilled" | "rejected";
}

// Insert a tracked request row; the id is pre-generated so callers that
// fire EXPECTED-violation inserts can assert no row was left behind by
// passing a caller-held id through trackRequest.
async function insertRequest(
  fx: BaseFixture,
  args: RequestRowArgs,
  id = randomUUID(),
): Promise<string> {
  createdRequestIds.push(id);
  await db.insert(mpRequest).values({
    id,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    type: args.type,
    ...(args.status ? { status: args.status } : {}),
    weekStart: args.weekStart,
    requestDate: args.requestDate,
    createdBy: fx.adminId,
  });
  return id;
}

interface LineRowArgs {
  requestId: string;
  workAreaId: string;
  shiftDefinitionId: string;
  positionId: string;
  date: string;
  headcount: number;
}

// Insert a tracked line row. position_id is NOT NULL and welded to the
// area's required set, so every fixture passes a pivoted position. Like
// insertRequest, the id is caller-overridable for expected-violation
// inserts that must leave no row behind.
async function insertLine(
  fx: BaseFixture,
  args: LineRowArgs,
  id = randomUUID(),
): Promise<string> {
  createdLineIds.push(id);
  await db.insert(mpRequestLine).values({
    id,
    requestId: args.requestId,
    siteId: fx.siteId,
    siteLocationId: fx.locationId,
    workAreaId: args.workAreaId,
    shiftDefinitionId: args.shiftDefinitionId,
    positionId: args.positionId,
    date: args.date,
    headcount: args.headcount,
  });
  return id;
}

afterAll(async () => {
  if (createdLineIds.length > 0) {
    await db.delete(mpRequestLine).where(
      inArray(mpRequestLine.id, createdLineIds),
    );
  }
  if (createdRequestIds.length > 0) {
    await db.delete(mpRequest).where(
      inArray(mpRequest.id, createdRequestIds),
    );
  }
  if (createdShiftIds.length > 0) {
    await db.delete(shiftDefinition).where(
      inArray(shiftDefinition.id, createdShiftIds),
    );
  }
  // The pivot references work areas and positions (both RESTRICT) — drop
  // it before either parent.
  if (createdPositionIds.length > 0) {
    await db.delete(workAreaPosition).where(
      inArray(workAreaPosition.positionId, createdPositionIds),
    );
  }
  if (createdWorkAreaIds.length > 0) {
    await db.delete(workArea).where(inArray(workArea.id, createdWorkAreaIds));
  }
  if (createdPositionIds.length > 0) {
    await db.delete(position).where(inArray(position.id, createdPositionIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
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

describe("mp_request (Module 3 requests)", () => {
  test("t-mp-anchor: weekly request happy path inserts with defaults", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "a");
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });

    const [row] = await db
      .select()
      .from(mpRequest)
      .where(eq(mpRequest.id, requestId));
    expect(row).toBeTruthy();
    expect(row.siteId).toBe(fx.siteId);
    expect(row.siteLocationId).toBe(fx.locationId);
    expect(row.type).toBe("weekly");
    expect(row.status).toBe("submitted");
    expect(row.weekStart).toBe(MONDAY);
    expect(row.requestDate).toBeNull();
    expect(row.createdBy).toBe(fx.adminId);
  });

  test("second open weekly request same location+week: rejected with 23505", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "b");
    await insertRequest(fx, { type: "weekly", weekStart: MONDAY });
    const dupeId = randomUUID();

    let code: string | undefined;
    try {
      await insertRequest(fx, { type: "weekly", weekStart: MONDAY }, dupeId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(mpRequest).where(eq(mpRequest.id, dupeId)))
        .length,
    ).toBe(0);
  });

  test("after the open request is rejected, a new one for the same week applies", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "c");
    const firstId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });
    await db
      .update(mpRequest)
      .set({ status: "rejected" })
      .where(eq(mpRequest.id, firstId));
    const reopenedId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });

    expect(
      (await db.select().from(mpRequest).where(eq(mpRequest.id, reopenedId)))
        .length,
    ).toBe(1);
  });

  test("daily-fulfilled slot is freed; a daily open request on the same date applies", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "d");
    await insertRequest(fx, {
      type: "daily",
      requestDate: TUESDAY,
      status: "fulfilled",
    });

    const freshId = await insertRequest(fx, {
      type: "daily",
      requestDate: TUESDAY,
    });
    expect(
      (await db.select().from(mpRequest).where(eq(mpRequest.id, freshId)))
        .length,
    ).toBe(1);
  });

  test("CHECK rejects a weekly request anchored on a Tuesday: 23514", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "e");
    const badId = randomUUID();

    let code: string | undefined;
    try {
      await insertRequest(
        fx,
        { type: "weekly", weekStart: TUESDAY },
        badId,
      );
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db.select().from(mpRequest).where(eq(mpRequest.id, badId)))
        .length,
    ).toBe(0);
  });

  test("CHECK requires exactly one anchor: daily with week_start is rejected", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "f");
    const badId = randomUUID();

    let code: string | undefined;
    try {
      await insertRequest(
        fx,
        { type: "daily", requestDate: TUESDAY, weekStart: MONDAY },
        badId,
      );
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db.select().from(mpRequest).where(eq(mpRequest.id, badId)))
        .length,
    ).toBe(0);
  });

  test("site weld: site_location_id from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const locationBId = await createLocation(run, "loc", siteBId);
    const adminId = await createUser(run);
    const badId = randomUUID();
    createdRequestIds.push(badId);

    let code: string | undefined;
    try {
      await db.insert(mpRequest).values({
        id: badId,
        siteId: siteAId, // claiming site A
        siteLocationId: locationBId, // from site B — mismatch
        type: "daily",
        requestDate: TUESDAY,
        createdBy: adminId,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(mpRequest).where(eq(mpRequest.id, badId)))
        .length,
    ).toBe(0);
  });
});

describe("mp_request_line (Module 3 request lines)", () => {
  test("t-mp-anchor: line inserts with cascade parent and round-trips", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "g");
    const workAreaId = await createWorkArea(fx, "wa1");
    const shiftId = await createShift(fx, 1);
    const positionId = await createPosition(fx, "p1");
    await createPivot(fx, workAreaId, positionId);
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    await db.insert(mpRequestLine).values({
      id: lineId,
      requestId,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      workAreaId,
      shiftDefinitionId: shiftId,
      positionId,
      date: "2026-01-05",
      headcount: 3,
    });

    const [row] = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.id, lineId));
    expect(row).toBeTruthy();
    expect(row.requestId).toBe(requestId);
    expect(row.workAreaId).toBe(workAreaId);
    expect(row.shiftDefinitionId).toBe(shiftId);
    expect(row.positionId).toBe(positionId);
    expect(row.date).toBe("2026-01-05");
    expect(row.headcount).toBe(3);
  });

  test("line weld: work area from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const locationAId = await createLocation(run, "locA", siteAId);
    const locationBId = await createLocation(run, "locB", siteBId);
    const adminId = await createUser(run);

    const fxOnB: BaseFixture = {
      siteId: siteBId,
      locationId: locationBId,
      adminId,
    };
    const foreignWorkAreaId = await createWorkArea(fxOnB, "foreign");

    const fxOnA: BaseFixture = {
      siteId: siteAId,
      locationId: locationAId,
      adminId,
    };
    const shiftId = await createShift(fxOnA, 1);
    // Position on the foreign area's site (site B), pivoted there — valid
    // on its own site; the line below claims site A, so the work-area weld
    // must fire.
    const foreignPositionId = await createPosition(fxOnB, "foreign-pos");
    await createPivot(fxOnB, foreignWorkAreaId, foreignPositionId);
    const requestId = await insertRequest(fxOnA, {
      type: "daily",
      requestDate: TUESDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    let code: string | undefined;
    try {
      await db.insert(mpRequestLine).values({
        id: lineId,
        requestId,
        siteId: siteAId,
        siteLocationId: locationAId,
        workAreaId: foreignWorkAreaId, // site B work area
        shiftDefinitionId: shiftId,
        positionId: foreignPositionId, // site B position
        date: TUESDAY,
        headcount: 2,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(mpRequestLine).where(eq(mpRequestLine.id, lineId)))
        .length,
    ).toBe(0);
  });

  test("line weld: shift definition from another site → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const locationAId = await createLocation(run, "locA", siteAId);
    const locationBId = await createLocation(run, "locB", siteBId);
    const adminId = await createUser(run);

    const fxOnB: BaseFixture = {
      siteId: siteBId,
      locationId: locationBId,
      adminId,
    };
    const foreignShiftId = await createShift(fxOnB, 1);

    const fxOnA: BaseFixture = {
      siteId: siteAId,
      locationId: locationAId,
      adminId,
    };
    const workAreaId = await createWorkArea(fxOnA, "wa");
    const positionId = await createPosition(fxOnA, "pos");
    await createPivot(fxOnA, workAreaId, positionId);
    const requestId = await insertRequest(fxOnA, {
      type: "daily",
      requestDate: TUESDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    let code: string | undefined;
    try {
      await db.insert(mpRequestLine).values({
        id: lineId,
        requestId,
        siteId: siteAId,
        siteLocationId: locationAId,
        workAreaId,
        shiftDefinitionId: foreignShiftId,
        positionId,
        date: TUESDAY,
        headcount: 2,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(mpRequestLine).where(eq(mpRequestLine.id, lineId)))
        .length,
    ).toBe(0);
  });

  test("headcount 0: rejected with 23514", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "h");
    const workAreaId = await createWorkArea(fx, "wa2");
    const shiftId = await createShift(fx, 1);
    const positionId = await createPosition(fx, "p0");
    await createPivot(fx, workAreaId, positionId);
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    let code: string | undefined;
    try {
      await db.insert(mpRequestLine).values({
        id: lineId,
        requestId,
        siteId: fx.siteId,
        siteLocationId: fx.locationId,
        workAreaId,
        shiftDefinitionId: shiftId,
        positionId,
        date: "2026-01-05",
        headcount: 0,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db.select().from(mpRequestLine).where(eq(mpRequestLine.id, lineId)))
        .length,
    ).toBe(0);
  });

  test("headcount 1000: rejected with 23514", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "i");
    const workAreaId = await createWorkArea(fx, "wa3");
    const shiftId = await createShift(fx, 1);
    const positionId = await createPosition(fx, "p1000");
    await createPivot(fx, workAreaId, positionId);
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    let code: string | undefined;
    try {
      await db.insert(mpRequestLine).values({
        id: lineId,
        requestId,
        siteId: fx.siteId,
        siteLocationId: fx.locationId,
        workAreaId,
        shiftDefinitionId: shiftId,
        positionId,
        date: "2026-01-05",
        headcount: 1000,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db.select().from(mpRequestLine).where(eq(mpRequestLine.id, lineId)))
        .length,
    ).toBe(0);
  });

  test("duplicate (request, work area, shift, position, date): rejected with 23505 on the new unique", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "j");
    const workAreaId = await createWorkArea(fx, "wa4");
    const shiftId = await createShift(fx, 1);
    const positionId = await createPosition(fx, "pdupe");
    await createPivot(fx, workAreaId, positionId);
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    await db.insert(mpRequestLine).values({
      id: lineId,
      requestId,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      workAreaId,
      shiftDefinitionId: shiftId,
      positionId,
      date: "2026-01-05",
      headcount: 1,
    });

    const dupeId = randomUUID();
    createdLineIds.push(dupeId);
    let code: string | undefined;
    let constraint: string | undefined;
    try {
      await db.insert(mpRequestLine).values({
        id: dupeId,
        requestId,
        siteId: fx.siteId,
        siteLocationId: fx.locationId,
        workAreaId,
        shiftDefinitionId: shiftId,
        positionId,
        date: "2026-01-05",
        headcount: 2,
      });
    } catch (err) {
      code = pgErrorCode(err);
      constraint = pgErrorConstraint(err);
    }
    expect(code).toBe("23505");
    expect(constraint).toBe(
      "mp_request_line_request_work_area_shift_position_date_unique",
    );
    expect(
      (await db.select().from(mpRequestLine).where(eq(mpRequestLine.id, dupeId)))
        .length,
    ).toBe(0);
  });

  test("distinct positions on the same request/area/shift/date both insert", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "l");
    const workAreaId = await createWorkArea(fx, "wa6");
    const shiftId = await createShift(fx, 1);
    const p1 = await createPosition(fx, "p1");
    await createPivot(fx, workAreaId, p1);
    const p2 = await createPosition(fx, "p2");
    await createPivot(fx, workAreaId, p2);
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });

    const firstId = await insertLine(fx, {
      requestId,
      workAreaId,
      shiftDefinitionId: shiftId,
      positionId: p1,
      date: "2026-01-05",
      headcount: 2,
    });
    const secondId = await insertLine(fx, {
      requestId,
      workAreaId,
      shiftDefinitionId: shiftId,
      positionId: p2,
      date: "2026-01-05",
      headcount: 1,
    });

    const rows = await db
      .select()
      .from(mpRequestLine)
      .where(eq(mpRequestLine.requestId, requestId));
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.positionId).sort()).toEqual(
      [p1, p2].sort(),
    );
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
  });

  test("position weld: same-site position outside the area's required set → 23503", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "m");
    const workAreaId = await createWorkArea(fx, "wa7");
    const shiftId = await createShift(fx, 1);
    // A position the area does NOT require (no pivot row), same site.
    const outsideId = await createPosition(fx, "outside");
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    let code: string | undefined;
    let constraint: string | undefined;
    try {
      await db.insert(mpRequestLine).values({
        id: lineId,
        requestId,
        siteId: fx.siteId,
        siteLocationId: fx.locationId,
        workAreaId,
        shiftDefinitionId: shiftId,
        positionId: outsideId,
        date: "2026-01-05",
        headcount: 1,
      });
    } catch (err) {
      code = pgErrorCode(err);
      constraint = pgErrorConstraint(err);
    }
    expect(code).toBe("23503");
    expect(constraint).toBe(
      "mp_request_line_work_area_position_weld_fk",
    );
    expect(
      (await db.select().from(mpRequestLine).where(eq(mpRequestLine.id, lineId)))
        .length,
    ).toBe(0);
  });

  test("position weld: cross-site position → 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const locationAId = await createLocation(run, "locA", siteAId);
    const locationBId = await createLocation(run, "locB", siteBId);
    const adminId = await createUser(run);

    const fxOnB: BaseFixture = {
      siteId: siteBId,
      locationId: locationBId,
      adminId,
    };
    const foreignPositionId = await createPosition(fxOnB, "cross-site");

    const fxOnA: BaseFixture = {
      siteId: siteAId,
      locationId: locationAId,
      adminId,
    };
    const workAreaId = await createWorkArea(fxOnA, "wa8");
    const shiftId = await createShift(fxOnA, 1);
    const requestId = await insertRequest(fxOnA, {
      type: "daily",
      requestDate: TUESDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    let code: string | undefined;
    try {
      await db.insert(mpRequestLine).values({
        id: lineId,
        requestId,
        siteId: siteAId,
        siteLocationId: locationAId,
        workAreaId,
        shiftDefinitionId: shiftId,
        positionId: foreignPositionId, // site B position
        date: TUESDAY,
        headcount: 1,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(mpRequestLine).where(eq(mpRequestLine.id, lineId)))
        .length,
    ).toBe(0);
  });

  test("deleting the request cascades to its lines", async () => {
    const run = `t${nextSeq()}`;
    const fx = await createBase(run, "k");
    const workAreaId = await createWorkArea(fx, "wa5");
    const shiftId = await createShift(fx, 1);
    const positionId = await createPosition(fx, "pcascade");
    await createPivot(fx, workAreaId, positionId);
    const requestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: MONDAY,
    });
    const lineId = randomUUID();
    createdLineIds.push(lineId);

    await db.insert(mpRequestLine).values({
      id: lineId,
      requestId,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      workAreaId,
      shiftDefinitionId: shiftId,
      positionId,
      date: "2026-01-05",
      headcount: 4,
    });

    // A second request with its own line, deleted to prove the cascade
    // removed the line (the first request's line must survive).
    const secondRequestId = await insertRequest(fx, {
      type: "weekly",
      weekStart: "2026-01-12", // next Monday after the first
    });
    const secondLineId = randomUUID();
    createdLineIds.push(secondLineId);
    await db.insert(mpRequestLine).values({
      id: secondLineId,
      requestId: secondRequestId,
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
      workAreaId,
      shiftDefinitionId: shiftId,
      positionId,
      date: "2026-01-06",
      headcount: 4,
    });

    await db.delete(mpRequest).where(eq(mpRequest.id, secondRequestId));
    expect(
      (await db
        .select()
        .from(mpRequestLine)
        .where(eq(mpRequestLine.requestId, secondRequestId))).length,
    ).toBe(0);
    expect(
      (await db
        .select()
        .from(mpRequestLine)
        .where(eq(mpRequestLine.requestId, requestId))).length,
    ).toBe(1);

    // Cleanup helper only tracks ids — drop the first request's line here
    // so afterAll's plain deletes suffice for the rest.
    await db.delete(mpRequestLine).where(eq(mpRequestLine.id, lineId));
  });
});
