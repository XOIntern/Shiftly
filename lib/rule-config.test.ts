import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { auditLog, rosterRuleConfig, site, siteLocation, user } from "../drizzle/schema";
import {
  loadEffectiveRules,
  loadGlobalRows,
  loadLocationRows,
  loadSiteRows,
  upsertRuleRow,
} from "./rule-config";

// Task 4 of the config-rules epic (GitHub #51): the DB layer that feeds the
// pure resolver. Like the Task 1 schema tests, these run against the real
// dev DB (docker shiftly-postgres :5433). Every query is scoped to the
// test's own site/actor/rule key — the DB is shared, so unscoped reads
// would see other tests' rows — and the upsert's one-transaction invariant
// is exercised the only way that shows it: a failing audit write must roll
// the config row back too.
describe("rule-config loaders (issue #51 task 4)", () => {
  test("rows at all three levels resolve most-specific-wins", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const globalId = randomUUID();
    const siteLevelId = randomUUID();
    const locationLevelId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `rule-loader-site-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Rule Loader Location",
      });
      await db.insert(rosterRuleConfig).values([
        { id: globalId, ruleKey: "C1", intValue: 5 },
        { id: siteLevelId, ruleKey: "C1", siteId, intValue: 6 },
        {
          id: locationLevelId,
          ruleKey: "C1",
          siteId,
          siteLocationId: locationId,
          intValue: 7,
        },
      ]);

      const rules = await loadEffectiveRules(locationId);
      expect(rules.c1).toEqual({ value: 7, source: "location" });

      // The level loaders return exactly the rows of their own scope.
      const globalRows = await loadGlobalRows();
      expect(globalRows.find((r) => r.ruleKey === "C1")).toEqual({
        ruleKey: "C1",
        intValue: 5,
        boolValue: null,
      });

      const siteRows = await loadSiteRows(siteId);
      expect(siteRows).toEqual([{ ruleKey: "C1", intValue: 6, boolValue: null }]);

      const locationRows = await loadLocationRows(siteId, locationId);
      expect(locationRows).toEqual([{ ruleKey: "C1", intValue: 7, boolValue: null }]);

      // Removing the location override lets the site row win.
      await db
        .delete(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, locationLevelId));
      expect((await loadEffectiveRules(locationId)).c1).toEqual({
        value: 6,
        source: "site",
      });
      await db
        .delete(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, siteLevelId));
      expect((await loadEffectiveRules(locationId)).c1).toEqual({
        value: 5,
        source: "global",
      });
    } finally {
      // Child-first: config rows reference the locations, the locations
      // reference the site. The global row has no site — delete it by id.
      await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.id, globalId));
      await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.siteId, siteId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("soft-deleted rows are excluded from loaders and resolution", async () => {
    const actorId = await seedActor();
    const siteId = randomUUID();
    const locationId = randomUUID();
    const siteLevelId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `rule-soft-site-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Rule Soft Location",
      });
      await db.insert(rosterRuleConfig).values({
        id: siteLevelId,
        ruleKey: "C1",
        siteId,
        intValue: 6,
      });
      // Soft-delete: the partial unique indexes and the loaders share the
      // "deleted_at is null" predicate, so this frees the scope.
      await db
        .update(rosterRuleConfig)
        .set({ deletedAt: new Date() })
        .where(eq(rosterRuleConfig.id, siteLevelId));

      expect(await loadSiteRows(siteId)).toEqual([]);
      expect((await loadEffectiveRules(locationId)).c1).toEqual({
        value: 5,
        source: "default",
      });

      // And the freed scope accepts a fresh row via the upsert path.
      await upsertRuleRow({
        ruleKey: "C1",
        scope: { kind: "site", siteId },
        intValue: 9,
        boolValue: null,
        actorId,
      });
      expect(await loadSiteRows(siteId)).toEqual([
        { ruleKey: "C1", intValue: 9, boolValue: null },
      ]);
    } finally {
      // Audits reference the site too, so they go before it (child-first).
      await db.delete(auditLog).where(eq(auditLog.actorId, actorId));
      await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.siteId, siteId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, actorId));
    }
  });
});

describe("upsertRuleRow (issue #51 task 4)", () => {
  test("updates the existing row in place and leaves exactly one audit row with old→new", async () => {
    const actorId = await seedActor();
    const siteId = randomUUID();
    const seededRowId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `rule-upsert-site-${siteId}` });
      await db.insert(rosterRuleConfig).values({
        id: seededRowId,
        ruleKey: "C1",
        siteId,
        intValue: 6,
      });

      // One upsert over an existing row: update in place, one audit.
      await upsertRuleRow({
        ruleKey: "C1",
        scope: { kind: "site", siteId },
        intValue: 7,
        boolValue: null,
        actorId,
      });

      const siteRows = await liveSiteRows(siteId);
      expect(siteRows).toHaveLength(1);
      expect(siteRows[0].id).toBe(seededRowId);
      expect(siteRows[0].intValue).toBe(7);

      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "roster_rule_config.change"),
            eq(auditLog.siteId, siteId),
          ),
        );
      expect(audits).toHaveLength(1);
      expect(audits[0].actorId).toBe(actorId);
      expect(audits[0].siteLocationId).toBeNull();
      expect(audits[0].details).toEqual({
        ruleKey: "C1",
        level: "site",
        oldValue: { intValue: 6, boolValue: null },
        newValue: { intValue: 7, boolValue: null },
      });
    } finally {
      await db.delete(auditLog).where(eq(auditLog.actorId, actorId));
      await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.siteId, siteId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, actorId));
    }
  });

  test("oldValue is null when no row exists at the scope yet; a scope change writes a new row", async () => {
    const actorId = await seedActor();
    const siteId = randomUUID();
    const locationId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `rule-fresh-site-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Rule Fresh Location",
      });

      await upsertRuleRow({
        ruleKey: "C2",
        scope: { kind: "location", siteId, siteLocationId: locationId },
        intValue: 18,
        boolValue: null,
        actorId,
      });

      await upsertRuleRow({
        ruleKey: "C2",
        scope: { kind: "global" },
        intValue: 20,
        boolValue: null,
        actorId,
      });

      // Both audits exist, each stamped for its own scope.
      const audits = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.actorId, actorId));
      expect(audits).toHaveLength(2);
      // jsonb columns type as unknown through drizzle — cast once, below.
      type AuditDetails = {
        ruleKey: string;
        level: "global" | "site" | "location";
        oldValue: { intValue: number | null; boolValue: boolean | null } | null;
        newValue: { intValue: number | null; boolValue: boolean | null };
      };
      const details = audits.map((a) => a.details as AuditDetails);
      expect(details.filter((d) => d.level === "location")).toEqual([
        {
          ruleKey: "C2",
          level: "location",
          oldValue: null,
          newValue: { intValue: 18, boolValue: null },
        },
      ]);
      expect(details.filter((d) => d.level === "global")).toEqual([
        {
          ruleKey: "C2",
          level: "global",
          oldValue: null,
          newValue: { intValue: 20, boolValue: null },
        },
      ]);
      const globalAudit = audits.find(
        (a) => (a.details as AuditDetails).level === "global",
      );
      expect(globalAudit?.siteId).toBeNull();
      expect(globalAudit?.siteLocationId).toBeNull();

      // The scope change wrote its own row: the location row was not
      // mutated by the global upsert.
      const locationRow = await db
        .select({ intValue: rosterRuleConfig.intValue })
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.siteLocationId, locationId));
      expect(locationRow).toEqual([{ intValue: 18 }]);
      expect((await loadGlobalRows()).find((r) => r.ruleKey === "C2")).toEqual({
        ruleKey: "C2",
        intValue: 20,
        boolValue: null,
      });
    } finally {
      // The global row has a null site_id: it must go by its own id, or it
      // leaks into the next run's oldValue.
      await db.delete(auditLog).where(eq(auditLog.actorId, actorId));
      await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.siteId, siteId));
      await db
        .delete(rosterRuleConfig)
        .where(
          and(
            eq(rosterRuleConfig.ruleKey, "C2"),
            isNull(rosterRuleConfig.siteId),
            isNull(rosterRuleConfig.siteLocationId),
          ),
        );
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, actorId));
    }
  });

  test("a failing audit write rolls the config row back (one transaction)", async () => {
    try {
      // actorId references a user that does not exist: the audit insert
      // violates its FK. The config row write must roll back with it.
      let code: string | undefined;
      try {
        await upsertRuleRow({
          ruleKey: "C5",
          scope: { kind: "global" },
          intValue: 5,
          boolValue: null,
          actorId: randomUUID(),
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code === "23503" || code === "23001").toBe(true);

      const globals = await db
        .select()
        .from(rosterRuleConfig)
        .where(
          and(
            eq(rosterRuleConfig.ruleKey, "C5"),
            eq(rosterRuleConfig.intValue, 5),
          ),
        );
      expect(globals).toEqual([]);
    } finally {
      await db
        .delete(rosterRuleConfig)
        .where(eq(rosterRuleConfig.ruleKey, "C5"));
    }
  });
});

// Live site-scoped config rows for one site, ordered for stable assertions.
async function liveSiteRows(siteId: string) {
  const rows = await db
    .select({
      id: rosterRuleConfig.id,
      intValue: rosterRuleConfig.intValue,
    })
    .from(rosterRuleConfig)
    .where(eq(rosterRuleConfig.siteId, siteId));
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

// A throwaway superadmin user as the audit actor (same fixture shape the
// Task 1 tests use).
async function seedActor(): Promise<string> {
  const actorId = randomUUID();
  await db.insert(user).values({
    id: actorId,
    name: "Rule Config Actor",
    email: `rule-actor-${actorId}@shiftly.test`,
    emailVerified: true,
    role: "superadmin",
  });
  return actorId;
}
