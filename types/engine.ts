// Roster rules C1–C7 (docs/architecture.md §5), keyed the same way the
// roster_rule_config rows (Task 1) address them:
// - C1 max work days per week (int)
// - C2 max work days per month (int)
// - C3 forward shift rotation 1→2→3 only (bool)
// - C4 rest day after shift 3 (bool)
// - C5 mandatory break after N accumulated work days (int)
// - C6 break length in consecutive days (int)
// - C7 work qualification match — dormant until worker qualifications and work-area requirements exist (bool)

export type RuleKey = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7";

// Where an effective rule's value came from, from most specific to least:
// location override → site override → global base → built-in default.
export type RuleSource = "default" | "global" | "site" | "location";

export interface EffectiveRule<T> {
  value: T;
  source: RuleSource;
}

// C1, C2, C5, C6 are int rules; C3, C4, C7 are bool rules.
export interface EffectiveRules {
  c1: EffectiveRule<number>;
  c2: EffectiveRule<number>;
  c3: EffectiveRule<boolean>;
  c4: EffectiveRule<boolean>;
  c5: EffectiveRule<number>;
  c6: EffectiveRule<number>;
  c7: EffectiveRule<boolean>;
}

// One assigned (worker, day, shift) row of a draft roster. The engine speaks
// ordered shift definitions: `shiftOrder` holds shift-definition ids by order
// index and C3/C4 compare indices into it, so shiftDefId must be a member.
export interface RosterAssignment {
  workerId: string;
  date: string; // "YYYY-MM-DD"
  shiftDefId: string; // member of shiftOrder
  workAreaId: string;
}

// Built-in defaults, used when no config row supplies a value at any scope.
// Frozen: resolveRules hands these entries back by reference in default-
// sourced results, so a mutating caller must not be able to corrupt the
// module-level defaults for everyone else.
export const DEFAULT_RULES: EffectiveRules = Object.freeze({
  c1: Object.freeze({ value: 5, source: "default" }),
  c2: Object.freeze({ value: 20, source: "default" }),
  c3: Object.freeze({ value: true, source: "default" }),
  c4: Object.freeze({ value: true, source: "default" }),
  c5: Object.freeze({ value: 60, source: "default" }),
  c6: Object.freeze({ value: 4, source: "default" }),
  c7: Object.freeze({ value: true, source: "default" }),
});
