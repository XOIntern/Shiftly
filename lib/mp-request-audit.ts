import { auditLog } from "../drizzle/schema";
import { db } from "./db";

// Transaction type produced by drizzle's db.transaction callback, so the
// writer always rides the caller's tx (same shape as lib/site-delete.ts).
type MpRequestTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The three audit entries the request actions write; a literal union so a
// typo in an action fails tsc instead of silently skipping the trail.
export const MP_REQUEST_AUDIT_ACTIONS = [
  "mp_request.create",
  "mp_request.update",
  "mp_request.status_change",
] as const;

export type MpRequestAuditAction = (typeof MP_REQUEST_AUDIT_ACTIONS)[number];

// Shared audit-row writer for the request actions: every mutation records
// its entry in the SAME transaction as the write (pattern:
// lib/rule-config.ts upsertRuleRow), so a change is never visible without
// its audit entry. The action files stay thin — this is the only place the
// module's audit_log insert lives.
export async function recordMpRequestAudit(
  tx: MpRequestTx,
  entry: {
    actorId: string;
    action: MpRequestAuditAction;
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
