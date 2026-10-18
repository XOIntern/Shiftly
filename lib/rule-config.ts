import { and, eq, isNull } from "drizzle-orm";

import { auditLog, rosterRuleConfig, siteLocation } from "../drizzle/schema";
import { db } from "./db";
import { resolveRules, type RuleConfigRow } from "./engine/resolve";
import type { EffectiveRules } from "./engine/types";

// The scope a config row (and its audit entry) belongs to. A location-level
// scope always names its parent site — mirrored by the table's CHECK weld.
export type RuleScope =
  | { kind: "global" }
  | { kind: "site"; siteId: string }
  | { kind: "location"; siteId: string; siteLocationId: string };

export type RuleLevel = RuleScope["kind"];

// Both value columns, as the audit's old/new snapshot. null distinguishes
// "no row" from "row with no value for this rule's column".
export interface RuleValueSnapshot {
  intValue: number | null;
  boolValue: boolean | null;
}

const configColumns = {
  ruleKey: rosterRuleConfig.ruleKey,
  intValue: rosterRuleConfig.intValue,
  boolValue: rosterRuleConfig.boolValue,
};

// Live = not soft-deleted, matching the partial unique indexes' predicate.
const liveGlobal = () =>
  and(
    isNull(rosterRuleConfig.siteId),
    isNull(rosterRuleConfig.siteLocationId),
    isNull(rosterRuleConfig.deletedAt),
  );
const liveSite = (siteId: string) =>
  and(
    eq(rosterRuleConfig.siteId, siteId),
    isNull(rosterRuleConfig.siteLocationId),
    isNull(rosterRuleConfig.deletedAt),
  );
const liveLocation = (siteId: string, siteLocationId: string) =>
  and(
    eq(rosterRuleConfig.siteId, siteId),
    eq(rosterRuleConfig.siteLocationId, siteLocationId),
    isNull(rosterRuleConfig.deletedAt),
  );

export async function loadGlobalRows(): Promise<RuleConfigRow[]> {
  return db
    .select(configColumns)
    .from(rosterRuleConfig)
    .where(liveGlobal());
}

export async function loadSiteRows(siteId: string): Promise<RuleConfigRow[]> {
  return db
    .select(configColumns)
    .from(rosterRuleConfig)
    .where(liveSite(siteId));
}

export async function loadLocationRows(
  siteId: string,
  siteLocationId: string,
): Promise<RuleConfigRow[]> {
  return db
    .select(configColumns)
    .from(rosterRuleConfig)
    .where(liveLocation(siteId, siteLocationId));
}

// Effective rules for one location: the three levels from DB rows into the
// pure resolver. The site_location must exist and be live — a deleted one
// resolves to "not found" like a user does in lib/session.ts.
export async function loadEffectiveRules(
  siteLocationId: string,
): Promise<EffectiveRules> {
  const [location] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(and(eq(siteLocation.id, siteLocationId), isNull(siteLocation.deletedAt)))
    .limit(1);
  if (!location) {
    throw new Error(`site_location not found: ${siteLocationId}`);
  }

  const [globalRows, siteRows, locationRows] = await Promise.all([
    loadGlobalRows(),
    loadSiteRows(location.siteId),
    loadLocationRows(location.siteId, siteLocationId),
  ]);

  return resolveRules(globalRows, siteRows, locationRows);
}

// Upsert one rule row at one scope and record the change in the audit log —
// row write and audit write share one transaction, so a config change is
// never visible without its audit entry (the audited-config pillar).
// Deleting an override row is out of scope: inheritance is leaving the
// level empty.
export async function upsertRuleRow({
  ruleKey,
  scope,
  intValue,
  boolValue,
  actorId,
}: {
  ruleKey: RuleConfigRow["ruleKey"];
  scope: RuleScope;
  intValue: number | null;
  boolValue: boolean | null;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const where = and(scopeWhere(scope), eq(rosterRuleConfig.ruleKey, ruleKey));
    const [current] = await tx
      .select({
        id: rosterRuleConfig.id,
        intValue: rosterRuleConfig.intValue,
        boolValue: rosterRuleConfig.boolValue,
      })
      .from(rosterRuleConfig)
      .where(where)
      .limit(1);

    const newValue: RuleValueSnapshot = { intValue, boolValue };
    // Old value read happens before the write; no live row at the scope
    // means null (a soft-deleted row frees the scope for a fresh insert).
    const oldValue: RuleValueSnapshot | null = current
      ? { intValue: current.intValue, boolValue: current.boolValue }
      : null;

    if (current) {
      await tx
        .update(rosterRuleConfig)
        .set({ intValue, boolValue })
        .where(eq(rosterRuleConfig.id, current.id));
    } else {
      await tx.insert(rosterRuleConfig).values({
        ruleKey,
        siteId: scope.kind === "global" ? null : scope.siteId,
        siteLocationId: scope.kind === "location" ? scope.siteLocationId : null,
        intValue,
        boolValue,
      });
    }

    await tx.insert(auditLog).values({
      actorId,
      action: "roster_rule_config.change",
      siteId: scope.kind === "global" ? null : scope.siteId,
      siteLocationId: scope.kind === "location" ? scope.siteLocationId : null,
      details: {
        ruleKey,
        level: scope.kind,
        oldValue,
        newValue,
      },
    });
  });
}

// Scope → live-row predicate, combined with the rule key at the call site
// so the read always targets exactly one (scope, key) row.
function scopeWhere(scope: RuleScope) {
  switch (scope.kind) {
    case "global":
      return liveGlobal();
    case "site":
      return liveSite(scope.siteId);
    case "location":
      return liveLocation(scope.siteId, scope.siteLocationId);
  }
}
