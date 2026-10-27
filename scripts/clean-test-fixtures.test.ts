import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditLog, mpRequest, site, siteLocation, user } from "@/drizzle/schema";

import {
  CHECKED_RESTRICT_FKS,
  deleteUnblockedFixtures,
  describeDatabaseUrl,
  inspectFixtures,
  isFixtureSiteName,
  isFixtureUserEmail,
} from "./clean-test-fixtures";

const ID = "4426bb87-bcc8-462e-be97-666af3b73e94";

describe("clean-test-fixtures pattern matching", () => {
  test("matches a fixture site only with the exact prefix and a uuid suffix", () => {
    expect(isFixtureSiteName(`t4-loc-fs-${ID}`)).toBe(true);
    expect(isFixtureSiteName("t4-loc-fs-")).toBe(false);
    expect(isFixtureSiteName("t4-loc-fs-warehouse")).toBe(false);
    expect(isFixtureSiteName(`t4-loc-fs-${ID}-copy`)).toBe(false);
    expect(isFixtureSiteName(`x-t4-loc-fs-${ID}`)).toBe(false);
    expect(isFixtureSiteName(`t4-loc-sc-alpha-${ID}`)).toBe(false);
  });

  test("matches fixture users by prefix, uuid and test address, never by domain alone", () => {
    expect(isFixtureUserEmail(`auth-guard-${ID}@shiftly.test`)).toBe(true);
    expect(isFixtureUserEmail("admin@shiftly.test")).toBe(false);
    expect(isFixtureUserEmail("auth-guard-someone@shiftly.test")).toBe(false);
    expect(isFixtureUserEmail(`auth-guard-${ID}@example.com`)).toBe(false);
    expect(isFixtureUserEmail(`auth-guard-${ID}@shiftly.test.evil`)).toBe(false);
  });

  test("leaves the t-mp-* actors alone: they own requests and are out of scope", () => {
    expect(isFixtureUserEmail(`t-mp-act-${ID}@shiftly.test`)).toBe(false);
  });
});

describe("clean-test-fixtures database url check", () => {
  test("refuses a missing url", () => {
    expect(describeDatabaseUrl(undefined).ok).toBe(false);
    expect(describeDatabaseUrl("").ok).toBe(false);
  });

  test("refuses an unexpanded ${...} reference", () => {
    const check = describeDatabaseUrl(
      "postgresql://u:p@localhost:${DB_PORT}/${DB_NAME}",
    );
    expect(check.ok).toBe(false);
  });

  test("refuses garbage and non-postgres urls", () => {
    expect(describeDatabaseUrl("not a url").ok).toBe(false);
    expect(describeDatabaseUrl("http://localhost:5432/x").ok).toBe(false);
    expect(describeDatabaseUrl("postgresql://u:p@localhost:5432").ok).toBe(
      false,
    );
  });

  test("describes a valid url as host:port/db without credentials", () => {
    expect(
      describeDatabaseUrl("postgresql://someone:s3cret@db.local:5433/shiftly_x"),
    ).toEqual({ ok: true, target: "db.local:5433/shiftly_x" });
    expect(describeDatabaseUrl("postgres://u:p@localhost/shiftly_y")).toEqual({
      ok: true,
      target: "localhost:5432/shiftly_y",
    });
  });
});

// Db-backed: every call passes onlyIds with the ids this suite created, so
// a run can never touch fixture rows anyone else left in the database.
describe("clean-test-fixtures against the database", () => {
  type Seed = {
    freeSiteId: string;
    freeUserId: string;
    blockedUserId: string;
    ownerSiteId: string;
    ownerLocationId: string;
    requestId: string;
  };

  async function seed(): Promise<Seed> {
    const s: Seed = {
      freeSiteId: randomUUID(),
      freeUserId: `cf-${randomUUID()}`,
      blockedUserId: `cf-${randomUUID()}`,
      ownerSiteId: randomUUID(),
      ownerLocationId: randomUUID(),
      requestId: randomUUID(),
    };
    await db.insert(site).values([
      { id: s.freeSiteId, name: `t4-loc-fs-${randomUUID()}` },
      { id: s.ownerSiteId, name: `cf-owner-${randomUUID()}` },
    ]);
    await db.insert(siteLocation).values({
      id: s.ownerLocationId,
      siteId: s.ownerSiteId,
      name: "cf-owner-loc",
    });
    await db.insert(user).values([
      {
        id: s.freeUserId,
        name: "cf free",
        email: `auth-guard-${randomUUID()}@shiftly.test`,
      },
      {
        id: s.blockedUserId,
        name: "cf blocked",
        email: `auth-guard-${randomUUID()}@shiftly.test`,
      },
    ]);
    // The free user wrote an audit row: it goes with the user.
    await db.insert(auditLog).values({
      actorId: s.freeUserId,
      action: "cf.test",
      details: {},
    });
    await db.insert(mpRequest).values({
      id: s.requestId,
      siteLocationId: s.ownerLocationId,
      siteId: s.ownerSiteId,
      type: "daily",
      requestDate: "2026-03-03",
      createdBy: s.blockedUserId,
    });
    return s;
  }

  async function cleanup(s: Seed) {
    const userIds = [s.freeUserId, s.blockedUserId];
    await db.delete(mpRequest).where(eq(mpRequest.id, s.requestId));
    await db.delete(auditLog).where(inArray(auditLog.actorId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
    await db
      .delete(siteLocation)
      .where(eq(siteLocation.id, s.ownerLocationId));
    await db
      .delete(site)
      .where(inArray(site.id, [s.freeSiteId, s.ownerSiteId]));
  }

  const onlyIdsOf = (s: Seed) => [
    s.freeSiteId,
    s.freeUserId,
    s.blockedUserId,
    s.ownerSiteId,
  ];

  test("the dry run lists every matched row and flags the blocked one", async () => {
    const s = await seed();
    try {
      const plan = await inspectFixtures(db, { onlyIds: onlyIdsOf(s) });
      const byId = new Map(plan.rows.map((row) => [row.id, row]));
      expect(plan.rows).toHaveLength(3);
      expect(byId.has(s.ownerSiteId)).toBe(false);
      expect(byId.get(s.freeSiteId)?.blockers).toEqual([]);
      expect(byId.get(s.freeUserId)?.blockers).toEqual([]);
      expect(byId.get(s.blockedUserId)?.blockers).toEqual([
        "mp_request.created_by (1)",
      ]);
      expect(plan.auditIds).toHaveLength(1);

      // Nothing was deleted.
      const users = await db
        .select({ id: user.id })
        .from(user)
        .where(inArray(user.id, [s.freeUserId, s.blockedUserId]));
      expect(users).toHaveLength(2);
    } finally {
      await cleanup(s);
    }
  });

  test("--yes deletes only the unblocked rows and reports the skipped one", async () => {
    const s = await seed();
    try {
      const plan = await deleteUnblockedFixtures(db, {
        onlyIds: onlyIdsOf(s),
      });
      const skipped = plan.rows.filter((row) => row.blockers.length > 0);
      expect(skipped.map((row) => row.id)).toEqual([s.blockedUserId]);
      expect(skipped[0].blockers).toEqual(["mp_request.created_by (1)"]);

      const sites = await db
        .select({ id: site.id })
        .from(site)
        .where(inArray(site.id, [s.freeSiteId, s.ownerSiteId]));
      expect(sites.map((row) => row.id)).toEqual([s.ownerSiteId]);
      const users = await db
        .select({ id: user.id })
        .from(user)
        .where(inArray(user.id, [s.freeUserId, s.blockedUserId]));
      expect(users.map((row) => row.id)).toEqual([s.blockedUserId]);
      const audits = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.actorId, s.freeUserId));
      expect(audits).toHaveLength(0);
      const requests = await db
        .select({ id: mpRequest.id })
        .from(mpRequest)
        .where(eq(mpRequest.id, s.requestId));
      expect(requests).toHaveLength(1);
    } finally {
      await cleanup(s);
    }
  });

  test("checks every restrict foreign key into site, site_location and user", async () => {
    const result = await db.execute<{ conname: string }>(sql`
      select conname from pg_constraint
      where contype = 'f' and confdeltype = 'r'
        and confrelid in ('site'::regclass, 'site_location'::regclass, '"user"'::regclass)`);
    expect(result.rows.map((row) => row.conname).sort()).toEqual(
      [...CHECKED_RESTRICT_FKS].sort(),
    );
  });
});
