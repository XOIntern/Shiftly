import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "../error/db-errors";
import {
  auditLog,
  rosterRuleConfig,
  site,
  siteLocation,
  user,
} from "../drizzle/schema";

// Task 1 of the config-rules epic (GitHub #48): roster_rule_config and
// audit_log. These tests run against the real dev DB (docker
// shiftly-postgres :5433) and pin the actual constraint behaviour: one
// config row per rule key per scope, scopes coexisting, and the CHECK
// weld that a location-level row always names its parent site.
describe("roster_rule_config scoping (issue #48 task 1)", () => {
  test("a second global row for the same rule key is refused (23505)", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();

    try {
      await db.insert(rosterRuleConfig).values({
        id: firstId,
        ruleKey: "C1",
        intValue: 5,
      });

      let code: string | undefined;
      try {
        await db.insert(rosterRuleConfig).values({
          id: secondId,
          ruleKey: "C1",
          intValue: 6,
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");
    } finally {
      await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.id, firstId));
    }
  });

  test("the same rule key at global, site and location scopes coexists", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const secondLocationId = randomUUID();
    const globalId = randomUUID();
    const siteLevelId = randomUUID();
    const locationLevelId = randomUUID();
    const secondLocationLevelId = randomUUID();

    try {
      await db
        .insert(site)
        .values({ id: siteId, name: `rule-cfg-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locationId, siteId, name: "Rule Cfg Location" },
        { id: secondLocationId, siteId, name: "Rule Cfg Location Two" },
      ]);
      await db.insert(rosterRuleConfig).values([
        { id: globalId, ruleKey: "C3", intValue: 20 },
        { id: siteLevelId, ruleKey: "C3", siteId, intValue: 18 },
        {
          id: locationLevelId,
          ruleKey: "C3",
          siteId,
          siteLocationId: locationId,
          intValue: 16,
        },
        {
          id: secondLocationLevelId,
          ruleKey: "C3",
          siteId,
          siteLocationId: secondLocationId,
          intValue: 14,
        },
      ]);

      // All four scopes for C3 are present after the writes.
      const rows = await db
        .select({ id: rosterRuleConfig.id })
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.ruleKey, "C3"));
      expect(new Set(rows.map((r) => r.id))).toEqual(
        new Set([
          globalId,
          siteLevelId,
          locationLevelId,
          secondLocationLevelId,
        ]),
      );
    } finally {
      // Child-first: config rows reference the locations, the locations
      // reference the site.
      await db
        .delete(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, globalId));
      await db
        .delete(rosterRuleConfig)
        .where(eq(rosterRuleConfig.siteId, siteId));
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("a location-level row without site_id is refused by the CHECK (23514)", async () => {
    let code: string | undefined;
    try {
      // siteLocationId alone: the FK target need not exist — the CHECK fires
      // during row insertion, before any FK enforcement.
      await db.insert(rosterRuleConfig).values({
        id: randomUUID(),
        ruleKey: "C4",
        siteLocationId: randomUUID(),
        intValue: 1,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23514");
  });

  test("FK restrict: config rows hold their site and location; audit rows hold their actor", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const actorId = randomUUID();
    const siteLevelId = randomUUID();
    const locationLevelId = randomUUID();

    try {
      await db
        .insert(site)
        .values({ id: siteId, name: `rule-fk-site-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Rule FK Location",
      });
      await db.insert(user).values({
        id: actorId,
        name: "Rule Config Actor",
        email: `rule-cfg-${actorId}@shiftly.test`,
        emailVerified: true,
        role: "superadmin",
      });
      await db.insert(rosterRuleConfig).values([
        { id: siteLevelId, ruleKey: "C2", siteId, boolValue: true },
        {
          id: locationLevelId,
          ruleKey: "C2",
          siteId,
          siteLocationId: locationId,
          boolValue: true,
        },
      ]);

      // Deleting either referenced row violates its RESTRICT FK.
      let siteCode: string | undefined;
      try {
        await db.delete(site).where(eq(site.id, siteId));
      } catch (err) {
        siteCode = pgErrorCode(err);
      }
      expect(siteCode === "23001" || siteCode === "23503").toBe(true);

      let locCode: string | undefined;
      try {
        await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      } catch (err) {
        locCode = pgErrorCode(err);
      }
      expect(locCode === "23001" || locCode === "23503").toBe(true);

      // audit_log.actor_id is RESTRICT too.
      await db.insert(auditLog).values({
        id: randomUUID(),
        actorId,
        action: "test.insert",
        details: { old: null, new: { ruleKey: "C2" } },
      });
      let actorCode: string | undefined;
      try {
        await db.delete(user).where(eq(user.id, actorId));
      } catch (err) {
        actorCode = pgErrorCode(err);
      }
      expect(actorCode === "23001" || actorCode === "23503").toBe(true);
    } finally {
      await db
        .delete(rosterRuleConfig)
        .where(eq(rosterRuleConfig.siteId, siteId));
      await db.delete(auditLog).where(eq(auditLog.actorId, actorId));
      await db.delete(user).where(eq(user.id, actorId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("audit_log round-trips action and details and stamps created_at", async () => {
    const actorId = randomUUID();
    const logId = randomUUID();

    try {
      await db.insert(user).values({
        id: actorId,
        name: "Audit Round Trip",
        email: `audit-rt-${actorId}@shiftly.test`,
        emailVerified: true,
        role: "ho",
      });
      await db.insert(auditLog).values({
        id: logId,
        actorId,
        action: "roster_rule_config.update",
        siteId: null,
        siteLocationId: null,
        details: { old: { intValue: 5 }, new: { intValue: 6 } },
      });

      const [row] = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, logId));
      expect(row.action).toBe("roster_rule_config.update");
      expect(row.details).toEqual({
        old: { intValue: 5 },
        new: { intValue: 6 },
      });
      expect(row.siteId).toBeNull();
      expect(row.siteLocationId).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
    } finally {
      await db.delete(auditLog).where(eq(auditLog.id, logId));
      await db.delete(user).where(eq(user.id, actorId));
    }
  });
});
