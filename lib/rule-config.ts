import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { auditLog, rosterRuleConfig, site, siteLocation } from "../drizzle/schema";
import { db } from "./db";
import { resolveRules, type RuleConfigRow } from "./engine/resolve";
import { DEFAULT_RULES, type EffectiveRules } from "./engine/types";

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

// Where a C5 write would leave effective C6 above the new trigger (GitHub
// #56). Unlike a raw row scan, the check judges the *effective* C6 — the
// most-specific live row, else the built-in default — at the write's own
// scope and at every live location below it. A site-level C6 row that
// every live location overrides is inert and never blocks; a violation
// inherited from the global row or the default does block, which a
// descendant-row scan cannot see. Value-less (int_value null) and
// soft-deleted rows never count.
export interface C6Violation {
  label: string;
}

export async function findC6Violations(
  newC5: number,
  scope: RuleScope,
): Promise<C6Violation[]> {
  const defaultC6 = DEFAULT_RULES.c6.value;
  const siteFilter =
    scope.kind === "global"
      ? undefined
      : eq(rosterRuleConfig.siteId, scope.siteId);

  const [globalRows, siteRows, locationRows, liveLocations] = await Promise.all([
    db
      .select({ intValue: rosterRuleConfig.intValue })
      .from(rosterRuleConfig)
      .where(and(eq(rosterRuleConfig.ruleKey, "C6"), liveGlobal())),
    db
      .select({
        siteId: rosterRuleConfig.siteId,
        intValue: rosterRuleConfig.intValue,
        siteName: site.name,
      })
      .from(rosterRuleConfig)
      .innerJoin(
        site,
        and(eq(rosterRuleConfig.siteId, site.id), isNull(site.deletedAt)),
      )
      .where(
        and(
          eq(rosterRuleConfig.ruleKey, "C6"),
          isNotNull(rosterRuleConfig.siteId),
          isNull(rosterRuleConfig.siteLocationId),
          isNull(rosterRuleConfig.deletedAt),
          siteFilter,
        ),
      ),
    db
      .select({
        siteLocationId: rosterRuleConfig.siteLocationId,
        intValue: rosterRuleConfig.intValue,
      })
      .from(rosterRuleConfig)
      .innerJoin(
        siteLocation,
        and(
          eq(rosterRuleConfig.siteLocationId, siteLocation.id),
          isNull(siteLocation.deletedAt),
        ),
      )
      .where(
        and(
          eq(rosterRuleConfig.ruleKey, "C6"),
          isNotNull(rosterRuleConfig.siteId),
          isNotNull(rosterRuleConfig.siteLocationId),
          isNull(rosterRuleConfig.deletedAt),
          siteFilter,
        ),
      ),
    // Every live location in reach, rows or not — the resolution points the
    // effective check must visit (a location with no C6 row still inherits).
    db
      .select({
        id: siteLocation.id,
        siteId: siteLocation.siteId,
        name: siteLocation.name,
        siteName: site.name,
      })
      .from(siteLocation)
      .innerJoin(
        site,
        and(eq(siteLocation.siteId, site.id), isNull(site.deletedAt)),
      )
      .where(
        and(
          isNull(siteLocation.deletedAt),
          scope.kind === "location"
            ? eq(siteLocation.id, scope.siteLocationId)
            : scope.kind === "site"
              ? eq(siteLocation.siteId, scope.siteId)
              : undefined,
        ),
      ),
  ]);

  const globalC6 =
    globalRows.find((row) => row.intValue !== null)?.intValue ?? null;
  const siteC6 = new Map(
    siteRows
      .filter((row) => row.siteId !== null && row.intValue !== null)
      .map((row) => [row.siteId as string, row.intValue as number]),
  );
  const siteNames = new Map(
    siteRows.map((row) => [row.siteId as string, row.siteName]),
  );
  const locationC6 = new Map(
    locationRows
      .filter((row) => row.siteLocationId !== null && row.intValue !== null)
      .map((row) => [row.siteLocationId as string, row.intValue as number]),
  );

  const effectiveAtSite = (sid: string): number =>
    siteC6.get(sid) ?? globalC6 ?? defaultC6;
  const effectiveAtLocation = (locId: string, locSiteId: string): number =>
    locationC6.get(locId) ?? effectiveAtSite(locSiteId);

  const violations: C6Violation[] = [];

  // The write scope's own pair — the same-scope, inherited and default C6
  // paths a descendant-only scan cannot see.
  if (scope.kind === "global") {
    if ((globalC6 ?? defaultC6) > newC5) {
      violations.push({ label: "the global base" });
    }
  } else {
    const [scopeSite] = await db
      .select({ name: site.name })
      .from(site)
      .where(and(eq(site.id, scope.siteId), isNull(site.deletedAt)))
      .limit(1);
    if (!scopeSite) return violations;
    if (scope.kind === "site") {
      if (effectiveAtSite(scope.siteId) > newC5) {
        violations.push({ label: scopeSite.name });
      }
    } else if (
      effectiveAtLocation(scope.siteLocationId, scope.siteId) > newC5
    ) {
      const locName =
        liveLocations.find((loc) => loc.id === scope.siteLocationId)?.name ??
        "Location";
      violations.push({ label: `${locName} (${scopeSite.name})` });
    }
  }

  // Descendant scopes (none for a location-level write). A site with live
  // locations is judged per location — its own row only reaches locations
  // without one, so a fully-overridden row stays inert. A site with no
  // live locations is judged on its site row alone.
  if (scope.kind !== "location") {
    const siteIdsWithLocations = new Set(liveLocations.map((loc) => loc.siteId));
    for (const loc of liveLocations) {
      if (effectiveAtLocation(loc.id, loc.siteId) > newC5) {
        violations.push({ label: `${loc.name} (${loc.siteName})` });
      }
    }
    for (const [siteId, value] of siteC6) {
      if (value > newC5 && !siteIdsWithLocations.has(siteId)) {
        violations.push({
          label: siteNames.get(siteId) ?? siteId,
        });
      }
    }
  }

  return violations.sort((a, b) => a.label.localeCompare(b.label));
}
