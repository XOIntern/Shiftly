/// <reference types="bun" />
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "../error/db-errors";
import {
  position,
  site,
  siteLocation,
  worker,
  workerPosition,
} from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// Pinning test (GitHub #83): the worker table's composite site_location FK
// pins the location onto the SAME site as the denormalized site_id — a
// cross-site pairing must be rejected at the DB level with 23503 no matter
// which site the worker row itself claims. The partial unique on
// (site_location_id, employee_id) makes employee_id unique per location
// among live rows (soft delete frees it), and the location FK's ON DELETE
// RESTRICT protects live workers from losing their site_location. Position
// qualifications live on worker_position (see the suite below).
let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

describe("worker composite-FK & unique guards (worker table spec, 2026-10-20)", () => {
  test("site_location from site B + site_id = A: rejected with 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const locationId = randomUUID();
    const workerId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.id, workerId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    });
    await db.insert(site).values([
      { id: siteAId, name: `${run}-worker-site-a-${siteAId}` },
      { id: siteBId, name: `${run}-worker-site-b-${siteBId}` },
    ]);
    await db.insert(siteLocation).values({
      id: locationId,
      siteId: siteBId,
      name: `${run}-Location B`,
    });

    let code: string | undefined;
    try {
      await db.insert(worker).values({
        id: workerId,
        siteLocationId: locationId, // site B — mismatch
        siteId: siteAId,
        employeeId: `${run}-emp-1`,
        name: `${run}-Cross Location Worker`,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");

    // The rejected insert must have left nothing behind.
    const rows = await db
      .select()
      .from(worker)
      .where(eq(worker.id, workerId));
    expect(rows).toHaveLength(0);
  });

  test("positive control: same-site location + position round-trips", async () => {
    const run = `t${nextSeq()}`;
    const siteId = randomUUID();
    const locationId = randomUUID();
    const workerId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.id, workerId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({
      id: siteId,
      name: `${run}-worker-site-${siteId}`,
    });
    await db.insert(siteLocation).values({
      id: locationId,
      siteId,
      name: `${run}-Location Same`,
    });

    await db.insert(worker).values({
      id: workerId,
      siteLocationId: locationId,
      siteId,
      employeeId: `${run}-emp-1`,
      name: `${run}-Same Site Worker`,
      contractEndDate: "2026-12-31",
    });

    const [row] = await db
      .select()
      .from(worker)
      .where(eq(worker.id, workerId));
    expect(row).toBeTruthy();
    expect(row.siteLocationId).toBe(locationId);
    expect(row.siteId).toBe(siteId);
    expect(row.employeeId).toBe(`${run}-emp-1`);
    expect(row.name).toBe(`${run}-Same Site Worker`);
    expect(row.contractEndDate).toBe("2026-12-31");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
  });

  test("same employee_id under another location of the same site: allowed", async () => {
    const run = `t${nextSeq()}`;
    const siteId = randomUUID();
    const location1Id = randomUUID();
    const location2Id = randomUUID();
    const worker1Id = randomUUID();
    const worker2Id = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.id, worker1Id));
      await db.delete(worker).where(eq(worker.id, worker2Id));
      await db.delete(siteLocation).where(eq(siteLocation.id, location1Id));
      await db.delete(siteLocation).where(eq(siteLocation.id, location2Id));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({
      id: siteId,
      name: `${run}-worker-site-${siteId}`,
    });
    await db.insert(siteLocation).values([
      { id: location1Id, siteId, name: `${run}-Location One` },
      { id: location2Id, siteId, name: `${run}-Location Two` },
    ]);

    await db.insert(worker).values({
      id: worker1Id,
      siteLocationId: location1Id,
      siteId,
      employeeId: `${run}-emp-shared`,
      name: `${run}-Worker One`,
    });
    await db.insert(worker).values({
      id: worker2Id,
      siteLocationId: location2Id,
      siteId,
      employeeId: `${run}-emp-shared`,
      name: `${run}-Worker Two`,
    });

    const rows = await db
      .select()
      .from(worker)
      .where(eq(worker.employeeId, `${run}-emp-shared`));
    expect(rows).toHaveLength(2);
  });

  test("duplicate employee_id in one location: rejected with 23505, freed after soft delete", async () => {
    const run = `t${nextSeq()}`;
    const siteId = randomUUID();
    const locationId = randomUUID();
    const worker1Id = randomUUID();
    const worker2Id = randomUUID();
    const worker3Id = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.id, worker1Id));
      await db.delete(worker).where(eq(worker.id, worker2Id));
      await db.delete(worker).where(eq(worker.id, worker3Id));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({
      id: siteId,
      name: `${run}-worker-site-${siteId}`,
    });
    await db.insert(siteLocation).values({
      id: locationId,
      siteId,
      name: `${run}-Location One`,
    });

    await db.insert(worker).values({
      id: worker1Id,
      siteLocationId: locationId,
      siteId,
      employeeId: `${run}-emp-dup`,
      name: `${run}-Worker One`,
    });

    // Second live insert with the same (location, employee_id) → 23505.
    let code: string | undefined;
    try {
      await db.insert(worker).values({
        id: worker2Id,
        siteLocationId: locationId,
        siteId,
        employeeId: `${run}-emp-dup`,
        name: `${run}-Worker Two`,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");

    // Soft delete the first worker — the employee_id is freed again.
    await db
      .update(worker)
      .set({ deletedAt: new Date() })
      .where(eq(worker.id, worker1Id));

    await db.insert(worker).values({
      id: worker3Id,
      siteLocationId: locationId,
      siteId,
      employeeId: `${run}-emp-dup`,
      name: `${run}-Worker Three`,
    });

    const rows = await db
      .select()
      .from(worker)
      .where(eq(worker.employeeId, `${run}-emp-dup`));
    expect(rows).toHaveLength(2);
  });

  test("deleting a site_location with live workers: rejected with 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteId = randomUUID();
    const locationId = randomUUID();
    const workerId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.id, workerId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({
      id: siteId,
      name: `${run}-worker-site-${siteId}`,
    });
    await db.insert(siteLocation).values({
      id: locationId,
      siteId,
      name: `${run}-Location One`,
    });
    await db.insert(worker).values({
      id: workerId,
      siteLocationId: locationId,
      siteId,
      employeeId: `${run}-emp-1`,
      name: `${run}-Live Worker`,
    });

    let code: string | undefined;
    try {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    // ON DELETE RESTRICT blocks the delete, but Postgres reports the
    // delete-parent path as 23001 (restrict_violation), not 23503 —
    // same distinction REFERENCE_CODES already encodes (verified in
    // lib/location-fk.test.ts).
    expect(code).toBe("23001");

    // The rejected delete must have left the location in place.
    const rows = await db
      .select()
      .from(siteLocation)
      .where(eq(siteLocation.id, locationId));
    expect(rows).toHaveLength(1);
  });
});

// Multi-position spec (GitHub #92): worker_position is the qualification set.
// Its two composite FKs weld each pair to one site, so a cross-site pair and
// a duplicate pair are impossible even by direct insert.
type PivotFixture = {
  siteA: string;
  siteB: string;
  locationA: string;
  positionA: string;
  positionB: string;
  workerId: string;
};

let pivotSeq = 0;

async function seedPivotFixture(): Promise<PivotFixture> {
  const run = `t20-mp-${++pivotSeq}`;
  const siteA = randomUUID();
  const siteB = randomUUID();
  const locationA = randomUUID();
  const positionA = randomUUID();
  const positionB = randomUUID();
  const workerId = randomUUID();

  await db.insert(site).values([
    { id: siteA, name: `${run}-site-a-${siteA}` },
    { id: siteB, name: `${run}-site-b-${siteB}` },
  ]);
  await db.insert(siteLocation).values({
    id: locationA,
    siteId: siteA,
    name: `${run}-Location A`,
  });
  await db.insert(position).values([
    { id: positionA, siteId: siteA, name: `${run}-Position A` },
    { id: positionB, siteId: siteB, name: `${run}-Position B` },
  ]);
  await db.insert(worker).values({
    id: workerId,
    siteLocationId: locationA,
    siteId: siteA,
    employeeId: `${run}-emp-1`,
    name: `${run}-Worker`,
  });

  return { siteA, siteB, locationA, positionA, positionB, workerId };
}

async function dropPivotFixture(fixture: PivotFixture) {
  // Child-first: pivot → worker → position → location → site.
  await db
    .delete(workerPosition)
    .where(eq(workerPosition.workerId, fixture.workerId));
  await db.delete(worker).where(eq(worker.id, fixture.workerId));
  await db.delete(position).where(eq(position.id, fixture.positionA));
  await db.delete(position).where(eq(position.id, fixture.positionB));
  await db.delete(siteLocation).where(eq(siteLocation.id, fixture.locationA));
  await db.delete(site).where(eq(site.id, fixture.siteA));
  await db.delete(site).where(eq(site.id, fixture.siteB));
}

describe("worker_position composite-FK & PK guards (multi-position spec, 2026-10-20)", () => {
  test("position from site B + pivot site_id = A: rejected with 23503", async () => {
    const fixture = await seedPivotFixture();

    fixtureCleanup.defer(async () => {
      await dropPivotFixture(fixture);
    });
    let code: string | undefined;
    try {
      await db.insert(workerPosition).values({
        workerId: fixture.workerId,
        positionId: fixture.positionB,
        siteId: fixture.siteA,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");

    const rows = await db
      .select()
      .from(workerPosition)
      .where(eq(workerPosition.workerId, fixture.workerId));
    expect(rows).toHaveLength(0);
  });

  test("pivot site_id that does not match the worker's site: rejected with 23503", async () => {
    const fixture = await seedPivotFixture();

    fixtureCleanup.defer(async () => {
      await dropPivotFixture(fixture);
    });
    let code: string | undefined;
    try {
      await db.insert(workerPosition).values({
        workerId: fixture.workerId,
        positionId: fixture.positionA,
        siteId: fixture.siteB,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");

    const rows = await db
      .select()
      .from(workerPosition)
      .where(eq(workerPosition.workerId, fixture.workerId));
    expect(rows).toHaveLength(0);
  });

  test("duplicate (worker, position) pair: rejected with 23505", async () => {
    const fixture = await seedPivotFixture();

    fixtureCleanup.defer(async () => {
      await dropPivotFixture(fixture);
    });
    await db.insert(workerPosition).values({
      workerId: fixture.workerId,
      positionId: fixture.positionA,
      siteId: fixture.siteA,
    });

    let code: string | undefined;
    try {
      await db.insert(workerPosition).values({
        workerId: fixture.workerId,
        positionId: fixture.positionA,
        siteId: fixture.siteA,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
  });

  test("valid same-site pair: inserts", async () => {
    const fixture = await seedPivotFixture();

    fixtureCleanup.defer(async () => {
      await dropPivotFixture(fixture);
    });
    await db.insert(workerPosition).values({
      workerId: fixture.workerId,
      positionId: fixture.positionA,
      siteId: fixture.siteA,
    });

    const rows = await db
      .select()
      .from(workerPosition)
      .where(eq(workerPosition.workerId, fixture.workerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].positionId).toBe(fixture.positionA);
    expect(rows[0].siteId).toBe(fixture.siteA);
  });
});
