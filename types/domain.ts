import type { RuleKey } from "./engine";

// The shape Task 4's DB layer feeds in, one row per (scope, rule key).
// A row is "present with value" for a rule only when the value column that
// rule actually uses is non-null; null on both sides reads as absent.
export interface RuleConfigRow {
  ruleKey: RuleKey;
  intValue: number | null;
  boolValue: boolean | null;
}

// Must stay in sync with ROLES (lib/scope.ts): the type was previously
// derived as (typeof ROLES)[number], but types/ never imports from lib/,
// so the union is spelled out here.
export type Role = "superadmin" | "ho" | "admin";

export type Scope =
  | { kind: "all" }
  // A ho with no site binding scopes the empty set, not some site.
  | { kind: "site"; siteId: string | null }
  | { kind: "location"; siteLocationId: string | null };
