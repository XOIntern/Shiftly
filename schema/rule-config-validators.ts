import { z } from "zod";

// Sanity ranges for the int rules the HO settings form writes (task brief,
// GitHub #52): C1 1..7 days/week, C2 1..31 days/month, C5 and C6 at least
// one day; C3, C4 and C7 are toggles.
const INT_RANGES: Record<"C1" | "C2" | "C5" | "C6", { min: number; max?: number }> = {
  C1: { min: 1, max: 7 },
  C2: { min: 1, max: 31 },
  C5: { min: 1 },
  C6: { min: 1 },
};

const INT_RULE_KEYS = new Set<RuleKey>(["C1", "C2", "C5", "C6"]);
const BOOL_RULE_KEYS = new Set<RuleKey>(["C3", "C4", "C7"]);

import type { RuleKey } from "@/types/engine";

// One write payload: the rule key, its scope, and exactly one value column
// filled per the key's type. The siteLocationId is validated as a uuid
// here; ownership (it belongs to the actor's effective site) is the
// action's job — a parse-only check cannot see the DB.
const baseSchema = z.object({
  ruleKey: z.enum(["C1", "C2", "C3", "C4", "C5", "C6", "C7"] satisfies readonly RuleKey[]),
  scope: z.enum(["global", "site", "location"]),
  siteLocationId: z.uuid().optional(),
  intValue: z.number().int().nullish(),
  boolValue: z.boolean().nullish(),
});

// Builds the write schema for one scope resolution: c5Value is the C5 value
// effective where the write lands (resolved by the action from the config
// loaders), so the C6 refine judges against the rules that will actually
// apply. Violations land as field errors on the value column the form
// submits (intValue/boolValue), per the fieldErrorsFrom convention.
export function ruleConfigSchema(c5Value: number) {
  return baseSchema.superRefine((val, ctx) => {
    const ruleKey = val.ruleKey as RuleKey;

    if (INT_RULE_KEYS.has(ruleKey)) {
      const range = INT_RANGES[ruleKey as keyof typeof INT_RANGES];
      if (val.intValue === null || val.intValue === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["intValue"],
          message: "Value is required.",
        });
      } else if (
        val.intValue < range.min ||
        (range.max !== undefined && val.intValue > range.max)
      ) {
        const rangeText =
          range.max !== undefined
            ? `Must be between ${range.min} and ${range.max}.`
            : `Must be at least ${range.min}.`;
        ctx.addIssue({
          code: "custom",
          path: ["intValue"],
          message: rangeText,
        });
      }
      if (val.boolValue != null) {
        ctx.addIssue({
          code: "custom",
          path: ["boolValue"],
          message: "This rule takes a number, not a toggle.",
        });
      }
    }

    if (BOOL_RULE_KEYS.has(ruleKey)) {
      if (val.boolValue !== true && val.boolValue !== false) {
        ctx.addIssue({
          code: "custom",
          path: ["boolValue"],
          message: "Value is required.",
        });
      }
      if (val.intValue != null) {
        ctx.addIssue({
          code: "custom",
          path: ["intValue"],
          message: "This rule takes a toggle, not a number.",
        });
      }
    }

    // The pair rule: the break length must never exceed the mandatory-break
    // trigger that will be in force at this scope.
    if (ruleKey === "C6" && val.intValue != null && val.intValue > c5Value) {
      ctx.addIssue({
        code: "custom",
        path: ["intValue"],
        message: `Break length (C6) cannot exceed the mandatory break trigger (C5 = ${c5Value}).`,
      });
    }
  });
}

export type RuleConfigInput = z.infer<ReturnType<typeof ruleConfigSchema>>;
