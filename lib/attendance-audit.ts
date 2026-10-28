import { auditLog } from "../drizzle/schema";
import type { Tx } from "../types/db-tx";

// The attendance entries written to audit_log; a literal union so a typo in an
// action fails tsc instead of silently skipping the trail. The first recording
// of an unrecorded row is not a correction and is not audited.
export const ATTENDANCE_AUDIT_ACTIONS = [
  "attendance.correct",
  "attendance.unscheduled.add",
  "attendance.unscheduled.remove",
] as const;

export type AttendanceAuditAction = (typeof ATTENDANCE_AUDIT_ACTIONS)[number];

// Shared audit-row writer for the attendance actions: every audited change
// records its entry in the SAME transaction as the write (pattern:
// lib/roster-audit.ts), so an attendance change is never visible without its
// audit entry. This is the only place the module's audit_log insert lives.
export async function recordAttendanceAudit(
  tx: Tx,
  entry: {
    actorId: string;
    action: AttendanceAuditAction;
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
