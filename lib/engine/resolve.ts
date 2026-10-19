import type { EffectiveRule, EffectiveRules, RuleKey } from "@/types/engine";
import type { RuleConfigRow } from "@/types/domain";
import { DEFAULT_RULES } from "./types";

const readInt = (row: RuleConfigRow): number | null => row.intValue;
const readBool = (row: RuleConfigRow): boolean | null => row.boolValue;

// Most-specific present-with-value row wins per key; absent/null falls
// through to the parent level, then to the built-in default.
function resolveRule<T extends number | boolean>(
  key: RuleKey,
  read: (row: RuleConfigRow) => T | null,
  fallback: EffectiveRule<T>,
  global: RuleConfigRow[],
  site: RuleConfigRow[],
  location: RuleConfigRow[],
): EffectiveRule<T> {
  const levels = [
    [location, "location"],
    [site, "site"],
    [global, "global"],
  ] as const;

  for (const [rows, source] of levels) {
    for (const row of rows) {
      if (row.ruleKey !== key) continue;
      const value = read(row);
      if (value !== null) return { value, source };
    }
  }
  return fallback;
}

export function resolveRules(
  global: RuleConfigRow[],
  site: RuleConfigRow[],
  location: RuleConfigRow[],
): EffectiveRules {
  return {
    c1: resolveRule("C1", readInt, DEFAULT_RULES.c1, global, site, location),
    c2: resolveRule("C2", readInt, DEFAULT_RULES.c2, global, site, location),
    c3: resolveRule("C3", readBool, DEFAULT_RULES.c3, global, site, location),
    c4: resolveRule("C4", readBool, DEFAULT_RULES.c4, global, site, location),
    c5: resolveRule("C5", readInt, DEFAULT_RULES.c5, global, site, location),
    c6: resolveRule("C6", readInt, DEFAULT_RULES.c6, global, site, location),
    c7: resolveRule("C7", readBool, DEFAULT_RULES.c7, global, site, location),
    c8: resolveRule("C8", readBool, DEFAULT_RULES.c8, global, site, location),
  };
}
