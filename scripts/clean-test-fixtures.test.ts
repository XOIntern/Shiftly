import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  auditLog,
  mpRequest,
  site,
  siteLocation,
  user,
  worker,
} from "@/drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";

import {
  CASCADING_FKS,
  CHECKED_RESTRICT_FKS,
  deleteUnblockedFixtures,
  describeDatabaseUrl,
  inspectFixtures,
  isFixtureSiteName,
  isFixtureUserEmail,
} from "./clean-test-fixtures";

const fixtureCleanup = installCleanup();

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

  test("matches the requests suite's t-mp-* sites and actors by exact shape", () => {
    expect(isFixtureSiteName(`t-mp-s-a-${ID}`)).toBe(true);
    expect(isFixtureSiteName(`t-mp-s-b-${ID}`)).toBe(true);
    expect(isFixtureSiteName(`t-mp-s-c-${ID}`)).toBe(false);
    expect(isFixtureSiteName("t-mp-s-a-warehouse")).toBe(false);
    expect(isFixtureSiteName(`t-mp-s-a-${ID}-copy`)).toBe(false);
    expect(isFixtureUserEmail(`t-mp-act-${ID}@shiftly.test`)).toBe(true);
    expect(isFixtureUserEmail(`t-mp-act-${ID}@example.com`)).toBe(false);
    expect(isFixtureUserEmail("t-mp-act-someone@shiftly.test")).toBe(false);
  });

  test("still leaves the other t-* suites' rows alone", () => {
    expect(isFixtureUserEmail(`t-roster-act-${ID}@shiftly.test`)).toBe(false);
    expect(isFixtureSiteName(`t-roster-${ID}-site-x`)).toBe(false);
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

  test("refuses query parameters that override the host, port or database it would print", () => {
    for (const param of [
      "host=prod.example",
      "host=/var/run/postgresql",
      "hostaddr=10.0.0.5",
      "port=6543",
      "dbname=other",
      "db=other",
    ]) {
      const check = describeDatabaseUrl(
        `postgresql://u:p@localhost:5432/shiftly?${param}`,
      );
      expect(check.ok).toBe(false);
    }
  });

  test("accepts query parameters that do not change the target", () => {
    expect(
      describeDatabaseUrl("postgresql://u:p@localhost:5432/shiftly?sslmode=require"),
    ).toEqual({ ok: true, target: "localhost:5432/shiftly" });
  });

  test("refuses a malformed percent-encoding instead of throwing", () => {
    for (const url of [
      "postgresql://u:p@localhost:5432/shiftly%zz",
      "postgresql://u:p%@localhost:5432/shiftly",
      "postgresql://u%:p@localhost:5432/shiftly",
    ]) {
      expect(() => describeDatabaseUrl(url)).not.toThrow();
      expect(describeDatabaseUrl(url).ok).toBe(false);
    }
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

  // Ids first, teardown registered, then the inserts: a seed that fails
  // halfway still has its partial rows removed (the deletes are by id).
  function newSeed(): Seed {
    const s: Seed = {
      freeSiteId: randomUUID(),
      freeUserId: `cf-${randomUUID()}`,
      blockedUserId: `cf-${randomUUID()}`,
      ownerSiteId: randomUUID(),
      ownerLocationId: randomUUID(),
      requestId: randomUUID(),
    };
    fixtureCleanup.defer(() => cleanup(s));
    return s;
  }

  async function seed(s: Seed): Promise<void> {
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
    const s = newSeed();
    await seed(s);
    {
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
    }
  });

  test("--yes deletes only the unblocked rows and reports the skipped one", async () => {
    const s = newSeed();
    await seed(s);
    {
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
    }
  });

  test("checks every foreign key into site, site_location and user, whatever its delete rule", async () => {
    const result = await db.execute<{ conname: string; confdeltype: string }>(sql`
      select conname, confdeltype from pg_constraint
      where contype = 'f'
        and confrelid in ('site'::regclass, 'site_location'::regclass, '"user"'::regclass)`);
    const rules = new Map(result.rows.map((row) => [row.conname, row.confdeltype]));

    // The names are the whole set: a new FK of any kind (a future ON DELETE
    // CASCADE would let the script cascade-delete operational rows) fails here
    // until it is checked in the script or listed as an expected cascade.
    expect([...rules.keys()].sort()).toEqual(
      [...CHECKED_RESTRICT_FKS, ...CASCADING_FKS].sort(),
    );
    // And each keeps the rule the script was written for: a checked FK that
    // turned into a cascade would no longer block, a cascade that turned into a
    // restrict would start blocking user deletes.
    for (const name of CHECKED_RESTRICT_FKS) expect(rules.get(name)).toBe("r");
    for (const name of CASCADING_FKS) expect(rules.get(name)).toBe("c");
  });

  // Site-side blockers: a fixture site is only deletable when nothing
  // references it or its locations.
  type SiteFixture = {
    siteId: string;
    locationId: string;
    actorId: string;
    workerId: string;
    requestId: string;
    boundUserId: string;
  };

  function newSiteFixture(): SiteFixture {
    const f: SiteFixture = {
      siteId: randomUUID(),
      locationId: randomUUID(),
      actorId: `cf-${randomUUID()}`,
      workerId: randomUUID(),
      requestId: randomUUID(),
      boundUserId: `cf-${randomUUID()}`,
    };
    fixtureCleanup.defer(async () => {
      await db.delete(mpRequest).where(eq(mpRequest.id, f.requestId));
      await db.delete(worker).where(eq(worker.id, f.workerId));
      await db.delete(user).where(inArray(user.id, [f.actorId, f.boundUserId]));
      await db.delete(siteLocation).where(eq(siteLocation.id, f.locationId));
      await db.delete(site).where(eq(site.id, f.siteId));
    });
    return f;
  }

  async function insertSiteFixture(f: SiteFixture): Promise<void> {
    await db.insert(site).values({ id: f.siteId, name: `t4-loc-fs-${randomUUID()}` });
    await db
      .insert(siteLocation)
      .values({ id: f.locationId, siteId: f.siteId, name: "cf-site-loc" });
  }

  async function expectSiteBlockedBy(f: SiteFixture, blocker: string) {
    const plan = await inspectFixtures(db, { onlyIds: [f.siteId] });
    expect(plan.rows.map((row) => row.id)).toEqual([f.siteId]);
    expect(plan.rows[0].blockers).toEqual([blocker]);
    expect(plan.locationIds).toEqual([]);

    // --yes leaves it, and its location, alone.
    await deleteUnblockedFixtures(db, { onlyIds: [f.siteId] });
    const sites = await db.select({ id: site.id }).from(site).where(eq(site.id, f.siteId));
    const locations = await db
      .select({ id: siteLocation.id })
      .from(siteLocation)
      .where(eq(siteLocation.id, f.locationId));
    expect(sites).toHaveLength(1);
    expect(locations).toHaveLength(1);
  }

  test("a location with a worker blocks its site", async () => {
    const f = newSiteFixture();
    await insertSiteFixture(f);
    await db.insert(worker).values({
      id: f.workerId,
      siteId: f.siteId,
      siteLocationId: f.locationId,
      employeeId: `cf-emp-${f.workerId}`,
      name: "cf worker",
    });

    await expectSiteBlockedBy(f, "worker.site_location_id (1)");
  });

  test("a location with a request blocks its site", async () => {
    const f = newSiteFixture();
    await insertSiteFixture(f);
    await db.insert(user).values({
      id: f.actorId,
      name: "cf actor",
      email: `cf-${f.actorId}@shiftly.test`,
    });
    await db.insert(mpRequest).values({
      id: f.requestId,
      siteId: f.siteId,
      siteLocationId: f.locationId,
      type: "daily",
      requestDate: "2026-03-03",
      createdBy: f.actorId,
    });

    await expectSiteBlockedBy(f, "mp_request.site_location_id (1)");
  });

  test("a user bound to the site, who is not a matched fixture, blocks it", async () => {
    const f = newSiteFixture();
    await insertSiteFixture(f);
    await db.insert(user).values({
      id: f.boundUserId,
      name: "cf bound",
      email: `cf-${f.boundUserId}@shiftly.test`,
      siteId: f.siteId,
    });

    await expectSiteBlockedBy(f, "user.site_id (1)");
  });

  test("a free site is deleted together with its location", async () => {
    const f = newSiteFixture();
    await insertSiteFixture(f);

    const plan = await inspectFixtures(db, { onlyIds: [f.siteId] });
    expect(plan.rows[0].blockers).toEqual([]);
    expect(plan.locationIds).toEqual([f.locationId]);

    await deleteUnblockedFixtures(db, { onlyIds: [f.siteId] });
    expect(
      await db.select({ id: site.id }).from(site).where(eq(site.id, f.siteId)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: siteLocation.id })
        .from(siteLocation)
        .where(eq(siteLocation.id, f.locationId)),
    ).toHaveLength(0);
  });
});
