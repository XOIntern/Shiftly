import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { purgeLocationGuarded } from "./location-purge";
import {
  position,
  rosterRuleConfig,
  shiftDefinition,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
  worker,
  workerPosition,
} from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAssignment,
  seedAuditLog,
  seedLocation,
  seedMpRequest,
  seedPosition,
  seedRosterPlan,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

type Fixture = {
  siteId: string;
  locationId: string;
  areaId: string;
  positionId: string;
  shiftId: string;
  workerId: string;
  userId: string;
  configId: string;
};

// A soft-deleted location with one of everything the purge has to remove. The
// user is soft-deleted the way deleteLocation leaves it; the area, worker and
// shift are soft-deleted unless `liveChild` names them (deleteLocation only
// checks users, so live children can exist under a deleted location).
async function seedDeletedLocation(
  opts: { deleted?: boolean; site?: { id: string } } = {},
): Promise<Fixture> {
  const { deleted = true } = opts;
  const site = opts.site ?? (await seedSite(cleanup));
  const loc = await seedLocation(cleanup, site.id, { deleted });
  const pos = await seedPosition(cleanup, site.id, { deleted: true });
  const area = await seedWorkArea(cleanup, loc, {
    positionIds: [pos.id],
    deleted: true,
  });
  const shift = await seedShift(cleanup, loc, { deleted: true });
  const w = await seedWorker(cleanup, loc, {
    positionIds: [pos.id],
    deleted: true,
  });
  const configId = randomUUID();
  cleanup.defer(async () => {
    await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.id, configId));
  });
  await db.insert(rosterRuleConfig).values({
    id: configId,
    ruleKey: "C1",
    siteId: site.id,
    siteLocationId: loc.id,
    intValue: 5,
  });
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: site.id,
    siteLocationId: loc.id,
    deleted: true,
  });
  return {
    siteId: site.id,
    locationId: loc.id,
    areaId: area.id,
    positionId: pos.id,
    shiftId: shift.id,
    workerId: w.id,
    userId: admin.id,
    configId,
  };
}

// One count per table the purge touches; all zero means fully purged, all
// non-zero means nothing was touched.
async function remaining(f: Fixture) {
  const count = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    location: await count(
      db.select().from(siteLocation).where(eq(siteLocation.id, f.locationId)),
    ),
    area: await count(
      db.select().from(workArea).where(eq(workArea.id, f.areaId)),
    ),
    shift: await count(
      db
        .select()
        .from(shiftDefinition)
        .where(eq(shiftDefinition.id, f.shiftId)),
    ),
    worker: await count(
      db.select().from(worker).where(eq(worker.id, f.workerId)),
    ),
    workerPosition: await count(
      db
        .select()
        .from(workerPosition)
        .where(eq(workerPosition.workerId, f.workerId)),
    ),
    workAreaPosition: await count(
      db
        .select()
        .from(workAreaPosition)
        .where(eq(workAreaPosition.workAreaId, f.areaId)),
    ),
    config: await count(
      db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, f.configId)),
    ),
    user: await count(db.select().from(user).where(eq(user.id, f.userId))),
  };
}

const ALL_PRESENT = {
  location: 1,
  area: 1,
  shift: 1,
  worker: 1,
  workerPosition: 1,
  workAreaPosition: 1,
  config: 1,
  user: 1,
};
const ALL_GONE = Object.fromEntries(
  Object.keys(ALL_PRESENT).map((key) => [key, 0]),
) as typeof ALL_PRESENT;

function purge(locationId: string) {
  return db.transaction((tx) => purgeLocationGuarded(tx, locationId));
}

// A superadmin bound to no site: an audit actor or plan author that is NOT one
// of the location's users, so a test can isolate the location-level guards.
async function outsideActor(): Promise<string> {
  return (await seedUser(cleanup, { role: "superadmin" })).id;
}

describe("purgeLocationGuarded", () => {
  test("a location that is not soft-deleted is refused and kept", async () => {
    const f = await seedDeletedLocation({ deleted: false });

    expect(await purge(f.locationId)).toEqual({
      ok: false,
      message: "Deleted location not found.",
    });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("an unknown id is refused", async () => {
    expect(await purge(randomUUID())).toEqual({
      ok: false,
      message: "Deleted location not found.",
    });
  });

  test("a clean deleted location is removed with its soft-deleted children", async () => {
    const f = await seedDeletedLocation();

    expect(await purge(f.locationId)).toEqual({ ok: true });
    expect(await remaining(f)).toEqual(ALL_GONE);
  });

  test("a site's sibling location, positions and site survive the purge", async () => {
    const f = await seedDeletedLocation();
    const sibling = await seedDeletedLocation({ site: { id: f.siteId } });
    const liveSibling = await seedLocation(cleanup, f.siteId);

    expect(await purge(f.locationId)).toEqual({ ok: true });

    expect(await remaining(f)).toEqual(ALL_GONE);
    expect(await remaining(sibling)).toEqual(ALL_PRESENT);
    const survivors = await db
      .select({ id: siteLocation.id })
      .from(siteLocation)
      .where(eq(siteLocation.siteId, f.siteId));
    expect(survivors.map((r) => r.id).sort()).toEqual(
      [sibling.locationId, liveSibling.id].sort(),
    );
    // The position is the site's, not the location's: it stays.
    expect(
      await db.select().from(position).where(eq(position.id, f.positionId)),
    ).toHaveLength(1);
  });

  test("purging one location leaves another site's rows alone", async () => {
    const f = await seedDeletedLocation();
    const other = await seedDeletedLocation();

    expect(await purge(f.locationId)).toEqual({ ok: true });
    expect(await remaining(other)).toEqual(ALL_PRESENT);
  });

  describe("live children refuse the purge", () => {
    test("a live work area", async () => {
      const f = await seedDeletedLocation();
      await db
        .update(workArea)
        .set({ deletedAt: null })
        .where(eq(workArea.id, f.areaId));

      expect(await purge(f.locationId)).toEqual({
        ok: false,
        message: "Work areas still exist under this location",
      });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("a live worker", async () => {
      const f = await seedDeletedLocation();
      await db
        .update(worker)
        .set({ deletedAt: null })
        .where(eq(worker.id, f.workerId));

      expect(await purge(f.locationId)).toEqual({
        ok: false,
        message: "Workers still exist under this location",
      });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("a live shift", async () => {
      const f = await seedDeletedLocation();
      await db
        .update(shiftDefinition)
        .set({ deletedAt: null })
        .where(eq(shiftDefinition.id, f.shiftId));

      expect(await purge(f.locationId)).toEqual({
        ok: false,
        message: "Shifts still exist under this location",
      });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("a live bound user", async () => {
      const f = await seedDeletedLocation();
      await db
        .update(user)
        .set({ deletedAt: null })
        .where(eq(user.id, f.userId));

      expect(await purge(f.locationId)).toEqual({
        ok: false,
        message: "Users are still bound to this location",
      });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });
  });

  describe("history refuses the purge", () => {
    const ROSTER =
      "Location has roster history and cannot be permanently deleted";
    const REQUEST =
      "Location has request history and cannot be permanently deleted";
    const AUDIT = "Location has audit history and cannot be permanently deleted";

    test("a roster plan at the location", async () => {
      const f = await seedDeletedLocation();
      await seedRosterPlan(cleanup, { id: f.locationId, siteId: f.siteId });

      expect(await purge(f.locationId)).toEqual({ ok: false, message: ROSTER });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("a plan at another location generated by one of its users", async () => {
      const f = await seedDeletedLocation();
      const elsewhere = await seedLocation(cleanup, f.siteId);
      await seedRosterPlan(cleanup, elsewhere, { generatedBy: f.userId });

      expect(await purge(f.locationId)).toEqual({ ok: false, message: ROSTER });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("a plan at another location published by one of its users", async () => {
      const f = await seedDeletedLocation();
      const elsewhere = await seedLocation(cleanup, f.siteId);
      await seedRosterPlan(cleanup, elsewhere, { publishedBy: f.userId });

      expect(await purge(f.locationId)).toEqual({ ok: false, message: ROSTER });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("an assignment of one of its workers in a plan elsewhere", async () => {
      const f = await seedDeletedLocation();
      const author = await outsideActor();
      const elsewhere = await seedLocation(cleanup, f.siteId);
      const otherArea = await seedWorkArea(cleanup, elsewhere);
      const otherShift = await seedShift(cleanup, elsewhere);
      const plan = await seedRosterPlan(cleanup, elsewhere, {
        generatedBy: author,
      });
      await seedAssignment(cleanup, {
        planId: plan.id,
        loc: elsewhere,
        workerId: f.workerId,
        workAreaId: otherArea.id,
        shiftId: otherShift.id,
      });

      expect(await purge(f.locationId)).toEqual({ ok: false, message: ROSTER });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("a request at the location", async () => {
      const f = await seedDeletedLocation();
      const author = await outsideActor();
      await seedMpRequest(
        cleanup,
        { id: f.locationId, siteId: f.siteId },
        { createdBy: author },
      );

      expect(await purge(f.locationId)).toEqual({ ok: false, message: REQUEST });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("a request at another location created by one of its users", async () => {
      const f = await seedDeletedLocation();
      const elsewhere = await seedLocation(cleanup, f.siteId);
      await seedMpRequest(cleanup, elsewhere, { createdBy: f.userId });

      expect(await purge(f.locationId)).toEqual({ ok: false, message: REQUEST });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("an audit row at the location", async () => {
      const f = await seedDeletedLocation();
      const actor = await outsideActor();
      await seedAuditLog(cleanup, {
        actorId: actor,
        siteLocationId: f.locationId,
      });

      expect(await purge(f.locationId)).toEqual({ ok: false, message: AUDIT });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("an audit row authored by one of its users", async () => {
      const f = await seedDeletedLocation();
      await seedAuditLog(cleanup, { actorId: f.userId });

      expect(await purge(f.locationId)).toEqual({ ok: false, message: AUDIT });
      expect(await remaining(f)).toEqual(ALL_PRESENT);
    });

    test("an audit row at the site only does not block the purge", async () => {
      const f = await seedDeletedLocation();
      const actor = await outsideActor();
      await seedAuditLog(cleanup, { actorId: actor, siteId: f.siteId });

      expect(await purge(f.locationId)).toEqual({ ok: true });
      expect(await remaining(f)).toEqual(ALL_GONE);
    });
  });
});
