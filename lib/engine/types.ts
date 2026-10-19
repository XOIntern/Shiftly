import type { EffectiveRules } from "@/types/engine";

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
  c8: Object.freeze({ value: true, source: "default" }),
});
