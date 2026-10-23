import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { user } from "./auth-schema";
import { site, siteLocation } from "./site-schema";
import { auditLog } from "./audit-schema";

// DB-level pins for audit_log (append-only audit trail): the text actor FK
// (Better Auth's user.id is text), the nullable restrict FKs to site and
// site_location, the required jsonb details, and the parents-may-not-leave
// restrict that keeps written-once rows pointing at real rows. Fixtures are
// prefixed t-audit- and cleaned up after each run.

let fixtureSeq = 0;
const nextSeq = () => `t${++fixtureSeq}`;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdUserIds: string[] = [];
const createdAuditIds: string[] = [];

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-audit-${run}-site-${tag}-${siteId}`,
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
    name: `t-audit-${run}-loc-${tag}-${locationId}`,
  });
  return locationId;
}

// user.id is a text PK (auth.js), so actor_id is text — the FK type must
// match.
async function createActor(run: string): Promise<string> {
  const id = randomUUID();
  createdUserIds.push(id);
  await db.insert(user).values({
    id,
    name: `t-audit-${run}-actor`,
    email: `t-audit-${run}-${id}@shiftly.test`,
  });
  return id;
}

interface BaseFixture {
  siteId: string;
  locationId: string;
  actorId: string;
}

async function createBase(run: string, tag: string): Promise<BaseFixture> {
  const siteId = await createSite(run, tag);
  const locationId = await createLocation(run, tag, siteId);
  const actorId = await createActor(run);
  return { siteId, locationId, actorId };
}

interface AuditArgs {
  action?: string;
  details?: unknown;
  siteId?: string;
  siteLocationId?: string;
  actorId?: string;
}

// Insert a tracked audit row; the id is pre-generated so callers of
// EXPECTED-violation inserts can assert no row was left behind.
async function insertAudit(
  args: AuditArgs,
  id = randomUUID(),
): Promise<string> {
  createdAuditIds.push(id);
  await db.insert(auditLog).values({
    id,
    actorId: args.actorId as string,
    action: args.action ?? "test.action",
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    details: (args.details ?? { reason: "test" }) as never,
  });
  return id;
}

afterAll(async () => {
  if (createdAuditIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.id, createdAuditIds));
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

describe("audit_log (append-only audit trail)", () => {
  test("t-audit-anchor: inserts with defaults and literal scope ids", async () => {
    const run = nextSeq();
    const fx = await createBase(run, "a");
    const auditId = await insertAudit({
      actorId: fx.actorId,
      action: "roster.publish",
      siteId: fx.siteId,
      siteLocationId: fx.locationId,
    });

    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, auditId));
    expect(row).toBeTruthy();
    expect(row.actorId).toBe(fx.actorId);
    expect(row.action).toBe("roster.publish");
    expect(row.siteId).toBe(fx.siteId);
    expect(row.siteLocationId).toBe(fx.locationId);
    expect(row.details).toEqual({ reason: "test" });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("scope ids default to null; id and created_at come from defaults", async () => {
    const run = nextSeq();
    const actorId = await createActor(run);
    const [row] = await db
      .insert(auditLog)
      .values({ actorId, action: "config.change", details: { reason: run } })
      .returning({
        id: auditLog.id,
        siteId: auditLog.siteId,
        siteLocationId: auditLog.siteLocationId,
        createdAt: auditLog.createdAt,
      });
    createdAuditIds.push(row.id);

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.siteId).toBeNull();
    expect(row.siteLocationId).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("details round-trips a jsonb object", async () => {
    const run = nextSeq();
    const actorId = await createActor(run);
    const auditId = await insertAudit({
      actorId,
      details: { reason: "attendance fix", date: "2026-01-05", extra: [1, 2] },
    });

    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, auditId));
    expect(row.details).toEqual({
      reason: "attendance fix",
      date: "2026-01-05",
      extra: [1, 2],
    });
  });

  test("missing details: rejected with 23502", async () => {
    const run = nextSeq();
    const actorId = await createActor(run);
    const auditId = randomUUID();
    createdAuditIds.push(auditId);

    let code: string | undefined;
    try {
      await db.insert(auditLog).values({
        id: auditId,
        actorId,
        action: "roster.publish",
        details: undefined as never,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(auditLog).where(eq(auditLog.id, auditId)))
        .length,
    ).toBe(0);
  });

  test("missing actorId: rejected with 23502", async () => {
    const auditId = randomUUID();
    createdAuditIds.push(auditId);

    let code: string | undefined;
    try {
      await db.insert(auditLog).values({
        id: auditId,
        actorId: undefined as never,
        action: "roster.publish",
        details: { reason: "test" },
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(auditLog).where(eq(auditLog.id, auditId)))
        .length,
    ).toBe(0);
  });

  test("unknown actorId: rejected with 23503", async () => {
    const run = nextSeq();
    const actorId = await createActor(run);
    const auditId = randomUUID();
    createdAuditIds.push(auditId);

    let code: string | undefined;
    try {
      await insertAudit({ actorId: randomUUID() }, auditId);
      // Keep the actor tracked-and-deleted below from becoming the failure
      // under test: audit rows referencing nothing may not exist, so the
      // insert itself must be the one that throws.
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(actorId).toBeTruthy();
    expect(code).toBe("23503");
    expect(
      (await db.select().from(auditLog).where(eq(auditLog.id, auditId)))
        .length,
    ).toBe(0);
  });

  test("unknown siteId: rejected with 23503", async () => {
    const run = nextSeq();
    const actorId = await createActor(run);
    const auditId = randomUUID();
    createdAuditIds.push(auditId);

    let code: string | undefined;
    try {
      await insertAudit({ actorId, siteId: randomUUID() }, auditId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(auditLog).where(eq(auditLog.id, auditId)))
        .length,
    ).toBe(0);
  });

  test("unknown siteLocationId: rejected with 23503", async () => {
    const run = nextSeq();
    const actorId = await createActor(run);
    const auditId = randomUUID();
    createdAuditIds.push(auditId);

    let code: string | undefined;
    try {
      await insertAudit({ actorId, siteLocationId: randomUUID() }, auditId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(auditLog).where(eq(auditLog.id, auditId)))
        .length,
    ).toBe(0);
  });

  test("deleting the referenced site is restricted: 23001", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "restrict");
    const actorId = await createActor(run);
    await insertAudit({ actorId, siteId });

    let code: string | undefined;
    try {
      await db.delete(site).where(eq(site.id, siteId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23001");
    expect(
      (await db.select().from(site).where(eq(site.id, siteId))).length,
    ).toBe(1);
  });

  test("deleting the actor is restricted while their entries exist: 23001", async () => {
    const run = nextSeq();
    const actorId = await createActor(run);
    await insertAudit({ actorId });

    let code: string | undefined;
    try {
      await db.delete(user).where(eq(user.id, actorId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23001");
    expect(
      (await db.select().from(user).where(eq(user.id, actorId))).length,
    ).toBe(1);
  });
});
