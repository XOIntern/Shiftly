import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { rosterRuleConfig } from "./rule-config-schema";
import { site, siteLocation } from "./site-schema";

// DB-level pins for roster_rule_config (rules C1–C7): one live row per
// (scope, key) with scope widening global → site → location, each scope
// level holding its own partial unique that soft delete frees, the CHECK
// welding every location-level row to its parent site, the restrict FKs,
// and the C1–C7 enum. Fixtures are prefixed t-rule- and cleaned up after
// each run.

let fixtureSeq = 0;
const nextSeq = () => `t${++fixtureSeq}`;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];
const createdRuleIds: string[] = [];

interface ScopeFixture {
  siteId?: string;
  siteLocationId?: string;
}

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-rule-${run}-site-${tag}-${siteId}`,
  });
  return siteId;
}

async function createLocation(
  run: string,
  siteId: string,
): Promise<string> {
  const locationId = randomUUID();
  createdLocationIds.push(locationId);
  await db.insert(siteLocation).values({
    id: locationId,
    siteId,
    name: `t-rule-${run}-loc-${locationId}`,
  });
  return locationId;
}

interface RuleArgs extends ScopeFixture {
  ruleKey?: "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7";
  intValue?: number;
  boolValue?: boolean;
}

// Insert a tracked rule row; the id is pre-generated so callers of
// EXPECTED-violation inserts can assert no row was left behind.
async function insertRule(
  args: RuleArgs,
  id = randomUUID(),
): Promise<string> {
  createdRuleIds.push(id);
  await db.insert(rosterRuleConfig).values({
    id,
    ruleKey: args.ruleKey ?? "C5",
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    ...(args.intValue !== undefined ? { intValue: args.intValue } : {}),
    ...(args.boolValue !== undefined ? { boolValue: args.boolValue } : {}),
  });
  return id;
}

afterAll(async () => {
  if (createdRuleIds.length > 0) {
    await db
      .delete(rosterRuleConfig)
      .where(inArray(rosterRuleConfig.id, createdRuleIds));
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

describe("roster_rule_config", () => {
  test("t-rule-anchor: a global int rule inserts and round-trips", async () => {
    const ruleId = await insertRule({ ruleKey: "C5", intValue: 30 });

    const [row] = await db
      .select()
      .from(rosterRuleConfig)
      .where(eq(rosterRuleConfig.id, ruleId));
    expect(row).toBeTruthy();
    expect(row.ruleKey).toBe("C5");
    expect(row.intValue).toBe(30);
    expect(row.boolValue).toBeNull();
    expect(row.siteId).toBeNull();
    expect(row.siteLocationId).toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("a bool rule round-trips its value", async () => {
    const ruleId = await insertRule({ ruleKey: "C3", boolValue: false });

    const [row] = await db
      .select()
      .from(rosterRuleConfig)
      .where(eq(rosterRuleConfig.id, ruleId));
    expect(row.boolValue).toBe(false);
    expect(row.intValue).toBeNull();
  });

  test("duplicate live global rule key: rejected with 23505", async () => {
    await insertRule({ ruleKey: "C1", intValue: 5 });
    const dupeId = randomUUID();
    createdRuleIds.push(dupeId);

    let code: string | undefined;
    try {
      await insertRule({ ruleKey: "C1", intValue: 6 }, dupeId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, dupeId))).length,
    ).toBe(0);
  });

  test("a site override applies even when the key is set globally", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "override");
    await insertRule({ ruleKey: "C2", intValue: 20 });
    const overrideId = await insertRule({
      ruleKey: "C2",
      intValue: 25,
      siteId,
    });

    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, overrideId))).length,
    ).toBe(1);
  });

  test("duplicate live site rule: rejected with 23505", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "dupe");
    await insertRule({ ruleKey: "C2", intValue: 20, siteId });

    const dupeId = randomUUID();
    createdRuleIds.push(dupeId);
    let code: string | undefined;
    try {
      await insertRule({ ruleKey: "C2", intValue: 21, siteId }, dupeId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, dupeId))).length,
    ).toBe(0);
  });

  test("duplicate live location rule: rejected with 23505", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "loc");
    const locationId = await createLocation(run, siteId);
    await insertRule({ ruleKey: "C6", intValue: 30, siteId, siteLocationId: locationId });

    const dupeId = randomUUID();
    createdRuleIds.push(dupeId);
    let code: string | undefined;
    try {
      await insertRule(
        { ruleKey: "C6", intValue: 31, siteId, siteLocationId: locationId },
        dupeId,
      );
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, dupeId))).length,
    ).toBe(0);
  });

  test("the same key applies under different locations", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "multi");
    const locAId = await createLocation(run, siteId);
    const locBId = await createLocation(run, siteId);
    await insertRule({ ruleKey: "C4", boolValue: true, siteId, siteLocationId: locAId });
    const locBRuleId = await insertRule({
      ruleKey: "C4",
      boolValue: true,
      siteId,
      siteLocationId: locBId,
    });

    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, locBRuleId))).length,
    ).toBe(1);
  });

  test("a soft-deleted rule frees its scope: the key is re-establishable", async () => {
    const originalId = await insertRule({ ruleKey: "C4", intValue: 0 });

    const replacementId = randomUUID();
    createdRuleIds.push(replacementId);
    let code: string | undefined;
    try {
      await insertRule({ ruleKey: "C4", intValue: 0 }, replacementId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");

    await db
      .update(rosterRuleConfig)
      .set({ deletedAt: new Date() })
      .where(eq(rosterRuleConfig.id, originalId));

    const reinsertedId = await insertRule({ ruleKey: "C4", intValue: 0 });
    const [row] = await db
      .select()
      .from(rosterRuleConfig)
      .where(eq(rosterRuleConfig.id, reinsertedId));
    expect(row).toBeTruthy();
    expect(row.deletedAt).toBeNull();
  });

  test("CHECK welds every location-level row to its parent site: 23514", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "check");
    const locationId = await createLocation(run, siteId);
    const ruleId = randomUUID();
    createdRuleIds.push(ruleId);

    let code: string | undefined;
    try {
      await db.insert(rosterRuleConfig).values({
        id: ruleId,
        ruleKey: "C5",
        siteId: undefined as never,
        siteLocationId: locationId,
        intValue: 30,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, ruleId))).length,
    ).toBe(0);
  });

  test("unknown siteId: rejected with 23503", async () => {
    const ruleId = randomUUID();
    createdRuleIds.push(ruleId);

    let code: string | undefined;
    try {
      await insertRule({ ruleKey: "C1", siteId: randomUUID() }, ruleId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, ruleId))).length,
    ).toBe(0);
  });

  test("unknown siteLocationId: rejected with 23503", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "fk");
    const ruleId = randomUUID();
    createdRuleIds.push(ruleId);

    let code: string | undefined;
    try {
      await insertRule(
        { ruleKey: "C1", siteId, siteLocationId: randomUUID() },
        ruleId,
      );
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, ruleId))).length,
    ).toBe(0);
  });

  test("unknown rule key: rejected with 22P02", async () => {
    const ruleId = randomUUID();
    createdRuleIds.push(ruleId);

    let code: string | undefined;
    try {
      await db.insert(rosterRuleConfig).values({
        id: ruleId,
        ruleKey: "C8" as never,
        intValue: 1,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("22P02");
    expect(
      (await db
        .select()
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, ruleId))).length,
    ).toBe(0);
  });

  test("deleting the referenced site is restricted while a rule binds it: 23001", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "restrict");
    await insertRule({ ruleKey: "C2", intValue: 20, siteId });

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
});
