// What the roster page's single primary button is, whether it can be
// pressed, and why not. Pure so every state is unit-testable.

export type RosterGate =
  | { action: "none" }
  | { action: "generate"; enabled: boolean; reason: string | null }
  | { action: "publish"; enabled: boolean; reason: string | null }
  | { action: "revise"; enabled: true; reason: null };

export function rosterGate(input: {
  canWrite: boolean; // admin or superadmin
  planStatus: "draft" | "published" | null;
  approvedRequestCount: number; // approved weekly requests for the week and location
  approvedSlotCount: number; // total headcount (people) across those requests' lines
  blockingViolationCount: number;
}): RosterGate {
  if (!input.canWrite) return { action: "none" };

  if (input.planStatus === "published") {
    return { action: "revise", enabled: true, reason: null };
  }

  if (input.planStatus === "draft") {
    const n = input.blockingViolationCount;
    if (n > 0) {
      return {
        action: "publish",
        enabled: false,
        reason: `${n} rule warning${n === 1 ? "" : "s"} must be resolved before publishing`,
      };
    }
    return { action: "publish", enabled: true, reason: null };
  }

  if (input.approvedRequestCount === 0) {
    return {
      action: "generate",
      enabled: false,
      reason: "No request approved by HO for this week",
    };
  }
  return {
    action: "generate",
    enabled: true,
    reason: `${input.approvedSlotCount} slot${input.approvedSlotCount === 1 ? "" : "s"} from ${input.approvedRequestCount} request${input.approvedRequestCount === 1 ? "" : "s"}`,
  };
}
