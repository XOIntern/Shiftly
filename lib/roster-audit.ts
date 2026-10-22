import { auditLog } from "../drizzle/schema";
import { db } from "./db";

// Transaction type produced by drizzle's db.transaction callback, so the
// writer always rides the caller's tx (pattern: lib/mp-request-audit.ts).
type RosterTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The five audit entries the roster actions write; a literal union so a
// typo in an action fails tsc instead of silently skipping the trail.
export const ROSTER_AUDIT_ACTIONS = [
  "roster.generate",
  "roster.regenerate",
  "roster.revise",
  "roster.publish",
  "roster.daily_request.fill",
] as const;

export type RosterAuditAction = (typeof ROSTER_AUDIT_ACTIONS)[number];

// Shared audit-row writer for the roster actions: every mutation records
// its entry in the SAME transaction as the write (pattern:
// lib/rule-config.ts upsertRuleRow), so a plan change is never visible
// without its audit entry. This is the only place the roster module's
// audit_log insert lives.
export async function recordRosterAudit(
  tx: RosterTx,
  entry: {
    actorId: string;
    action: RosterAuditAction;
    siteId: string | null;
    siteLocationId: string | null;
    details: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    siteId: entry.siteId,
    siteLocationId: entry.siteLocationId,
    details: entry.details,
  });
}
