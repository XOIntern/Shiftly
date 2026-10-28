import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { purgePositionGuarded } from "./position-purge";
import { position, workAreaPosition, workerPosition } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedLocation,
  seedMpRequest,
  seedPosition,
  seedRequestLine,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

function purge(id: string) {
  return db.transaction((tx) => purgePositionGuarded(tx, id));
}

async function exists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: position.id })
    .from(position)
    .where(eq(position.id, id));
  return rows.length === 1;
}

const WORKERS = "Workers still reference this position";
const AREAS = "Position is still required by a work area";
const REQUESTS =
  "Position has request history and cannot be permanently deleted";

describe("purgePositionGuarded", () => {
  test("a position that is not soft-deleted is refused and kept", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id);

    expect(await purge(pos.id)).toEqual({
      ok: false,
      message: "Deleted position not found.",
    });
    expect(await exists(pos.id)).toBe(true);
  });

  test("an unknown id is refused", async () => {
    expect(await purge(randomUUID())).toEqual({
      ok: false,
      message: "Deleted position not found.",
    });
  });

  test("an unreferenced deleted position is removed", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await purge(pos.id)).toEqual({ ok: true });
    expect(await exists(pos.id)).toBe(false);
  });

  test("purging one position leaves its site's other positions alone", async () => {
    const site = await seedSite(cleanup);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const other = await seedPosition(cleanup, site.id, { deleted: true });

    expect(await purge(pos.id)).toEqual({ ok: true });
    expect(await exists(other.id)).toBe(true);
  });

  test("a live worker holding the position refuses the purge", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    await seedWorker(cleanup, loc, { positionIds: [pos.id] });

    expect(await purge(pos.id)).toEqual({ ok: false, message: WORKERS });
    expect(await exists(pos.id)).toBe(true);
  });

  test("a soft-deleted worker's link refuses the purge and stays in place", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const w = await seedWorker(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await purge(pos.id)).toEqual({ ok: false, message: WORKERS });
    expect(await exists(pos.id)).toBe(true);
    expect(
      await db
        .select()
        .from(workerPosition)
        .where(eq(workerPosition.workerId, w.id)),
    ).toHaveLength(1);
  });

  test("a live work area requiring the position refuses the purge", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    await seedWorkArea(cleanup, loc, { positionIds: [pos.id] });

    expect(await purge(pos.id)).toEqual({ ok: false, message: AREAS });
    expect(await exists(pos.id)).toBe(true);
  });

  test("a soft-deleted work area's link refuses the purge and stays in place", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });

    expect(await purge(pos.id)).toEqual({ ok: false, message: AREAS });
    expect(await exists(pos.id)).toBe(true);
    expect(
      await db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, area.id)),
    ).toHaveLength(1);
  });

  test("a request line naming the position is history and refuses the purge", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const pos = await seedPosition(cleanup, site.id, { deleted: true });
    const area = await seedWorkArea(cleanup, loc, {
      positionIds: [pos.id],
      deleted: true,
    });
    const shift = await seedShift(cleanup, loc, { deleted: true });
    const author = await seedUser(cleanup, { role: "superadmin" });
    const request = await seedMpRequest(cleanup, loc, { createdBy: author.id });
    await seedRequestLine(cleanup, {
      requestId: request.id,
      loc,
      workAreaId: area.id,
      shiftId: shift.id,
      positionId: pos.id,
    });

    expect(await purge(pos.id)).toEqual({ ok: false, message: REQUESTS });
    expect(await exists(pos.id)).toBe(true);
  });
});
