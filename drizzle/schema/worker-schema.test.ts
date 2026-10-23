import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { position } from "./position-schema";
import { site, siteLocation } from "./site-schema";
import { worker, workerPosition } from "./worker-schema";

// DB-level pins for worker / worker_position that lib/worker-fk.test.ts
// does not already cover — it owns the composite-FK welds (the cross-site
// 23503s, the pivot mismatches) and the employee_id unique behavior, so
// this suite defers to it for those and pins the rest: the required
// columns, the composite FKs rejecting fully unknown children, the
// contract_end_date column, and the restrict that keeps qualified workers
// alive while a worker_position row points at them. The plain unique on
// (id, site_id) is not asserted (any duplicate id hits the primary key
// first; the pair exists for FK resolution). Fixtures are prefixed
// t-worker- and cleaned up after each run.

let fixtureSeq = 0;
const nextSeq = () => `t${++fixtureSeq}`;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdPositionIds: string[] = [];
const createdWorkerIds: string[] = [];
const createdWorkerPositionRows: {
  workerId: string;
  positionId: string;
}[] = [];

async function createBase(
  run: string,
  tag: string,
): Promise<{ siteId: string; locationId: string; positionId: string }> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-worker-${run}-site-${tag}-${siteId}`,
  });
  const locationId = randomUUID();
  createdLocationIds.push(locationId);
  await db.insert(siteLocation).values({
    id: locationId,
    siteId,
    name: `t-worker-${run}-loc-${tag}-${locationId}`,
  });
  const positionId = randomUUID();
  createdPositionIds.push(positionId);
  await db.insert(position).values({
    id: positionId,
    siteId,
    name: `t-worker-pos-${tag}-${positionId}`,
  });
  return { siteId, locationId, positionId };
}

interface WorkerArgs {
  siteLocationId: string;
  siteId: string;
  employeeId?: string;
  name?: string;
  contractEndDate?: string;
}

async function createWorker(
  args: WorkerArgs,
  id = randomUUID(),
): Promise<string> {
  createdWorkerIds.push(id);
  await db.insert(worker).values({
    id,
    siteLocationId: args.siteLocationId,
    siteId: args.siteId,
    employeeId: args.employeeId ?? `t-worker-emp-${id}`,
    name: args.name ?? `t-worker-${id}`,
    ...(args.contractEndDate ? { contractEndDate: args.contractEndDate } : {}),
  });
  return id;
}

async function createWorkerPosition(
  workerId: string,
  positionId: string,
  siteId: string,
): Promise<void> {
  createdWorkerPositionRows.push({ workerId, positionId });
  await db.insert(workerPosition).values({ workerId, positionId, siteId });
}

afterAll(async () => {
  if (createdWorkerPositionRows.length > 0) {
    for (const { workerId, positionId } of createdWorkerPositionRows) {
      await db
        .delete(workerPosition)
        .where(
          sql`${workerPosition.workerId} = ${workerId} and ${workerPosition.positionId} = ${positionId}`,
        );
    }
  }
  if (createdWorkerIds.length > 0) {
    await db.delete(worker).where(inArray(worker.id, createdWorkerIds));
  }
  if (createdPositionIds.length > 0) {
    await db.delete(position).where(inArray(position.id, createdPositionIds));
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

describe("worker", () => {
  test("t-worker-anchor: same-site insert with contract_end_date round-trips", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "a");
    const workerId = await createWorker({
      siteLocationId: fx.locationId,
      siteId: fx.siteId,
      contractEndDate: "2026-12-31",
    });

    const [row] = await db
      .select()
      .from(worker)
      .where(eq(worker.id, workerId));
    expect(row).toBeTruthy();
    expect(row.siteLocationId).toBe(fx.locationId);
    expect(row.siteId).toBe(fx.siteId);
    expect(row.contractEndDate).toBe("2026-12-31");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("missing siteLocationId: rejected with 23502", async () => {
    const workerId = randomUUID();
    createdWorkerIds.push(workerId);

    let code: string | undefined;
    try {
      await db.insert(worker).values({
        id: workerId,
        siteLocationId: undefined as never,
        siteId: undefined as never,
        employeeId: "t-worker-missing-loc",
        name: "t-worker-missing-loc",
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(worker).where(eq(worker.id, workerId)))
        .length,
    ).toBe(0);
  });

  test("missing employeeId: rejected with 23502", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "e");
    const workerId = randomUUID();
    createdWorkerIds.push(workerId);

    let code: string | undefined;
    try {
      await db.insert(worker).values({
        id: workerId,
        siteLocationId: fx.locationId,
        siteId: fx.siteId,
        employeeId: undefined as never,
        name: `t-worker-${run}-no-emp`,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(worker).where(eq(worker.id, workerId)))
        .length,
    ).toBe(0);
  });

  test("missing name: rejected with 23502", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "n");
    const workerId = randomUUID();
    createdWorkerIds.push(workerId);

    let code: string | undefined;
    try {
      await db.insert(worker).values({
        id: workerId,
        siteLocationId: fx.locationId,
        siteId: fx.siteId,
        employeeId: `t-worker-${run}-no-name`,
        name: undefined as never,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(worker).where(eq(worker.id, workerId)))
        .length,
    ).toBe(0);
  });
});

describe("worker_position", () => {
  test("t-worker-anchor: same-site qualification inserts and round-trips", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "p");
    const workerId = await createWorker({
      siteLocationId: fx.locationId,
      siteId: fx.siteId,
    });
    await createWorkerPosition(workerId, fx.positionId, fx.siteId);

    const [row] = await db
      .select()
      .from(workerPosition)
      .where(eq(workerPosition.workerId, workerId));
    expect(row).toBeTruthy();
    expect(row.positionId).toBe(fx.positionId);
    expect(row.siteId).toBe(fx.siteId);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("unknown worker in the composite FK: rejected with 23503", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "u");
    const fakeWorkerId = randomUUID();

    let code: string | undefined;
    try {
      await db.insert(workerPosition).values({
        workerId: fakeWorkerId,
        positionId: fx.positionId,
        siteId: fx.siteId,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (
        await db
          .select()
          .from(workerPosition)
          .where(eq(workerPosition.workerId, fakeWorkerId))
      ).length,
    ).toBe(0);
  });

  test("unknown position in the composite FK: rejected with 23503", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "v");
    const workerId = await createWorker({
      siteLocationId: fx.locationId,
      siteId: fx.siteId,
    });

    let code: string | undefined;
    try {
      await db.insert(workerPosition).values({
        workerId,
        positionId: randomUUID(),
        siteId: fx.siteId,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (
        await db
          .select()
          .from(workerPosition)
          .where(eq(workerPosition.workerId, workerId))
      ).length,
    ).toBe(0);
  });

  test("deleting a worker who holds positions is restricted: 23001", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "w");
    const workerId = await createWorker({
      siteLocationId: fx.locationId,
      siteId: fx.siteId,
    });
    await createWorkerPosition(workerId, fx.positionId, fx.siteId);

    let code: string | undefined;
    try {
      await db.delete(worker).where(eq(worker.id, workerId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23001");
    expect(
      (await db.select().from(worker).where(eq(worker.id, workerId)))
        .length,
    ).toBe(1);
  });

  test("deleting a position still held by a worker is restricted: 23001", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "x");
    const workerId = await createWorker({
      siteLocationId: fx.locationId,
      siteId: fx.siteId,
    });
    await createWorkerPosition(workerId, fx.positionId, fx.siteId);

    let code: string | undefined;
    try {
      await db.delete(position).where(eq(position.id, fx.positionId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23001");
    expect(
      (await db.select().from(position).where(eq(position.id, fx.positionId)))
        .length,
    ).toBe(1);
  });
});
