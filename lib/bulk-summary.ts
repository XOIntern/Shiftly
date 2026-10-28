import { GENERIC_ERROR } from "@/lib/action-state";
import type { ActionState } from "@/types/action-state";

export type BulkSummary = {
  kind: "success" | "error";
  title: string;
  description?: string;
};

// The row noun for a page's copy, inflected by count: one is singular,
// everything else (zero included) plural.
export function nounFor(
  singular: string,
  plural = `${singular}s`,
): (count: number) => string {
  return (count) => (count === 1 ? singular : plural);
}

// What the toast says about a finished bulk action: the count that went
// through, and when some were skipped, why (the first refusal's message). A
// run where nothing went through reads as an error.
export function summarizeBulk(
  result: ActionState,
  verb: string,
  noun: (count: number) => string,
): BulkSummary {
  if (!result.ok) {
    return { kind: "error", title: result.message ?? GENERIC_ERROR };
  }
  const applied = result.applied ?? 0;
  const blocked = result.blocked ?? 0;
  if (applied === 0 && blocked > 0) {
    return { kind: "error", title: result.message ?? GENERIC_ERROR };
  }
  if (blocked > 0) {
    return {
      kind: "success",
      title: `${applied} ${noun(applied)} ${verb}, ${blocked} skipped`,
      description: result.message,
    };
  }
  return { kind: "success", title: `${applied} ${noun(applied)} ${verb}` };
}
