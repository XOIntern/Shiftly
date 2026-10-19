// Roster rules C1–C7 (docs/architecture.md §5), keyed the same way the
// roster_rule_config rows (Task 1) address them:
// - C1 max work days per week (int)
// - C2 max work days per month (int)
// - C3 forward shift rotation 1→2→3 only (bool)
// - C4 rest day after shift 3 (bool)
// - C5 mandatory break after N accumulated work days (int)
// - C6 break length in consecutive days (int)
// - C7 department/qualification match (bool)

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
