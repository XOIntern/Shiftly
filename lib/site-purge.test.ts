import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, inArray, or } from "drizzle-orm";

import { db } from "./db";
import { purgeSiteGuarded } from "./site-purge";
import {
  auditLog,
  mpRequest,
  position,
  rosterPlan,
  rosterRuleConfig,
  shiftDefinition,
  site,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
  worker,
  workerPosition,
} from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

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

const MONDAY = "2026-01-05";

// Children first, history before everything it points at. Idempotent: after a
// successful purge every statement simply matches zero rows.
async function wipe(f: Fixture) {
  await db
    .delete(auditLog)
    .where(
      or(
        eq(auditLog.siteId, f.siteId),
        eq(auditLog.siteLocationId, f.locationId),
        eq(auditLog.actorId, f.userId),
      ),
    );
  await db.delete(rosterPlan).where(eq(rosterPlan.siteId, f.siteId));
  await db.delete(mpRequest).where(eq(mpRequest.siteId, f.siteId));
  await db.delete(workerPosition).where(eq(workerPosition.siteId, f.siteId));
  await db
    .delete(workAreaPosition)
    .where(eq(workAreaPosition.siteId, f.siteId));
  await db.delete(worker).where(eq(worker.siteId, f.siteId));
  await db.delete(workArea).where(eq(workArea.siteId, f.siteId));
  await db.delete(shiftDefinition).where(eq(shiftDefinition.siteId, f.siteId));
  await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.siteId, f.siteId));
  await db.delete(user).where(eq(user.id, f.userId));
  await db.delete(position).where(eq(position.siteId, f.siteId));
  await db.delete(siteLocation).where(eq(siteLocation.siteId, f.siteId));
  await db.delete(site).where(eq(site.id, f.siteId));
}

// A soft-deleted site with one of everything the purge has to remove. The
// location, work area and user are soft-deleted the way deleteSiteGuarded
// leaves them; worker, position and shift are soft-deleted when `softMaster`
// is set and live otherwise (the site delete guards never check them).
async function seedDeletedSite(
  opts: { softMaster?: boolean; deleted?: boolean } = {},
): Promise<Fixture> {
  const { softMaster = true, deleted = true } = opts;
  const now = new Date();
  const f: Fixture = {
    siteId: randomUUID(),
    locationId: randomUUID(),
    areaId: randomUUID(),
    positionId: randomUUID(),
    shiftId: randomUUID(),
    workerId: randomUUID(),
    userId: randomUUID(),
    configId: randomUUID(),
  };
  fixtureCleanup.defer(() => wipe(f));
  const masterDeletedAt = softMaster ? now : null;

  await db.insert(site).values({
    id: f.siteId,
    name: `t185-purge-${f.siteId}`,
    isActive: false,
    deletedAt: deleted ? now : null,
  });
  await db.insert(siteLocation).values({
    id: f.locationId,
    siteId: f.siteId,
    name: "Warehouse",
    deletedAt: now,
  });
  await db.insert(position).values({
    id: f.positionId,
    siteId: f.siteId,
    name: "Picker",
    deletedAt: masterDeletedAt,
  });
  await db.insert(workArea).values({
    id: f.areaId,
    siteLocationId: f.locationId,
    siteId: f.siteId,
    name: "Kitchen",
    deletedAt: now,
  });
  await db.insert(workAreaPosition).values({
    workAreaId: f.areaId,
    positionId: f.positionId,
    siteId: f.siteId,
    siteLocationId: f.locationId,
  });
  await db.insert(shiftDefinition).values({
    id: f.shiftId,
    siteLocationId: f.locationId,
    siteId: f.siteId,
    label: "Early",
    orderIndex: 1,
    startTime: "06:00",
    endTime: "14:00",
    deletedAt: masterDeletedAt,
  });
  await db.insert(worker).values({
    id: f.workerId,
    siteLocationId: f.locationId,
    siteId: f.siteId,
    employeeId: `EMP-${f.workerId.slice(0, 8)}`,
    name: "Budi Santoso",
    deletedAt: masterDeletedAt,
  });
  await db.insert(workerPosition).values({
    workerId: f.workerId,
    positionId: f.positionId,
    siteId: f.siteId,
  });
  await db.insert(rosterRuleConfig).values({
    id: f.configId,
    ruleKey: "C1",
    siteId: f.siteId,
    intValue: 5,
  });
  await db.insert(user).values({
    id: f.userId,
    name: "Purge Test Admin",
    email: `purge-${f.userId}@shiftly.test`,
    emailVerified: true,
    role: "admin",
    siteLocationId: f.locationId,
    isActive: false,
    deletedAt: now,
  });
  return f;
}

// One count per table the purge touches; all zero means fully purged, all
// non-zero means nothing was touched.
async function remaining(f: Fixture) {
  const count = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    site: await count(db.select().from(site).where(eq(site.id, f.siteId))),
    location: await count(
      db.select().from(siteLocation).where(eq(siteLocation.id, f.locationId)),
    ),
    area: await count(
      db.select().from(workArea).where(eq(workArea.id, f.areaId)),
    ),
    position: await count(
      db.select().from(position).where(eq(position.id, f.positionId)),
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
  site: 1,
  location: 1,
  area: 1,
  position: 1,
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

// A superadmin bound to no site: an audit actor that is NOT one of the site's
// users, so a test can isolate the site-id / location-id audit guards. Called
// before seedDeletedSite so its teardown (last-registered runs first) lands
// after the fixture's wipe has removed the audit rows it authored.
async function outsideActor(): Promise<string> {
  const id = randomUUID();
  fixtureCleanup.defer(async () => {
    await db.delete(user).where(eq(user.id, id));
  });
  await db.insert(user).values({
    id,
    name: "Outside Superadmin",
    email: `purge-outside-${id}@shiftly.test`,
    emailVerified: true,
    role: "superadmin",
  });
  return id;
}

function purge(siteId: string) {
  return db.transaction((tx) => purgeSiteGuarded(tx, siteId));
}

describe("purgeSiteGuarded", () => {
  test("a site that is not soft-deleted is refused and kept", async () => {
    const f = await seedDeletedSite({ deleted: false });

    expect(await purge(f.siteId)).toEqual({
      ok: false,
      message: "Deleted site not found.",
    });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("an unknown id is refused", async () => {
    expect(await purge(randomUUID())).toEqual({
      ok: false,
      message: "Deleted site not found.",
    });
  });

  test("a clean deleted site is removed with all its master data", async () => {
    const f = await seedDeletedSite();

    expect(await purge(f.siteId)).toEqual({ ok: true });
    expect(await remaining(f)).toEqual(ALL_GONE);
  });

  test("live workers, positions and shifts do not block the purge", async () => {
    const f = await seedDeletedSite({ softMaster: false });

    expect(await purge(f.siteId)).toEqual({ ok: true });
    expect(await remaining(f)).toEqual(ALL_GONE);
  });

  test("a live location is refused and nothing is deleted", async () => {
    const f = await seedDeletedSite();
    await db
      .update(siteLocation)
      .set({ deletedAt: null })
      .where(eq(siteLocation.id, f.locationId));

    expect(await purge(f.siteId)).toEqual({
      ok: false,
      message: "Locations still exist under this site",
    });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("a live work area is refused and nothing is deleted", async () => {
    const f = await seedDeletedSite();
    await db
      .update(workArea)
      .set({ deletedAt: null })
      .where(eq(workArea.id, f.areaId));

    expect(await purge(f.siteId)).toEqual({
      ok: false,
      message: "Work areas still exist under this site",
    });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("a live user bound to a location is refused and nothing is deleted", async () => {
    const f = await seedDeletedSite();
    await db.update(user).set({ deletedAt: null }).where(eq(user.id, f.userId));

    expect(await purge(f.siteId)).toEqual({
      ok: false,
      message: "Users are still bound to this site",
    });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("a roster plan is history: refused and nothing is deleted", async () => {
    const f = await seedDeletedSite();
    await db.insert(rosterPlan).values({
      siteLocationId: f.locationId,
      siteId: f.siteId,
      kind: "weekly",
      weekStart: MONDAY,
      rulesSnapshot: {},
    });

    expect(await purge(f.siteId)).toEqual({
      ok: false,
      message: "Site has roster history and cannot be permanently deleted",
    });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("a request is history: refused and nothing is deleted", async () => {
    const f = await seedDeletedSite();
    await db.insert(mpRequest).values({
      siteLocationId: f.locationId,
      siteId: f.siteId,
      type: "weekly",
      weekStart: MONDAY,
      createdBy: f.userId,
    });

    expect(await purge(f.siteId)).toEqual({
      ok: false,
      message: "Site has request history and cannot be permanently deleted",
    });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  const AUDIT_MESSAGE =
    "Site has audit history and cannot be permanently deleted";

  test("an audit row on the site is history", async () => {
    const actorId = await outsideActor();
    const f = await seedDeletedSite();
    await db.insert(auditLog).values({
      actorId,
      action: "test.site",
      siteId: f.siteId,
      details: {},
    });

    expect(await purge(f.siteId)).toEqual({ ok: false, message: AUDIT_MESSAGE });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("an audit row on one of the site's locations is history", async () => {
    const actorId = await outsideActor();
    const f = await seedDeletedSite();
    await db.insert(auditLog).values({
      actorId,
      action: "test.location",
      siteLocationId: f.locationId,
      details: {},
    });

    expect(await purge(f.siteId)).toEqual({ ok: false, message: AUDIT_MESSAGE });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("an audit row authored by one of the site's users is history", async () => {
    const f = await seedDeletedSite();
    await db.insert(auditLog).values({
      actorId: f.userId,
      action: "test.actor",
      details: {},
    });

    expect(await purge(f.siteId)).toEqual({ ok: false, message: AUDIT_MESSAGE });
    expect(await remaining(f)).toEqual(ALL_PRESENT);
  });

  test("purging one site leaves another site's rows alone", async () => {
    const f = await seedDeletedSite();
    const other = await seedDeletedSite();

    expect(await purge(f.siteId)).toEqual({ ok: true });
    expect(await remaining(f)).toEqual(ALL_GONE);
    expect(await remaining(other)).toEqual(ALL_PRESENT);
    expect(
      await db
        .select({ id: site.id })
        .from(site)
        .where(inArray(site.id, [other.siteId])),
    ).toHaveLength(1);
  });
});
