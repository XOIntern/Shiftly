import { desc, eq } from "drizzle-orm";

import { auditLog, siteLocation, user } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { auditLogListWhere } from "@/lib/audit-scope";
import type { AttendanceAuditAction } from "@/lib/attendance-audit";
import type { MpRequestAuditAction } from "@/lib/mp-request-audit";
import type { RosterAuditAction } from "@/lib/roster-audit";
import type { ScopeActor } from "@/types/session";

export type AuditFeedEntry = {
  id: string;
  action: string;
  label: string;
  actorName: string;
  locationName: string | null;
  createdAt: string;
};

type KnownAuditAction =
  | RosterAuditAction
  | AttendanceAuditAction
  | MpRequestAuditAction;

// Typed over every action the writers can record, so a new action fails tsc
// until it has a label here.
const ACTION_LABELS: Record<KnownAuditAction, string> = {
  "roster.generate": "Generated a roster",
  "roster.regenerate": "Regenerated a roster",
  "roster.revise": "Revised a roster",
  "roster.publish": "Published a roster",
  "roster.discard": "Discarded a roster draft",
  "roster.daily_request.fill": "Filled a daily request",
  "attendance.correct": "Corrected attendance",
  "attendance.unscheduled.add": "Added unscheduled attendance",
  "attendance.unscheduled.remove": "Removed unscheduled attendance",
  "mp_request.create": "Created a manpower request",
  "mp_request.update": "Updated a manpower request",
  "mp_request.status_change": "Changed a request status",
};

// An action outside the table (an old or foreign row) shows its raw string.
export function auditActionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action)
    ? ACTION_LABELS[action as KnownAuditAction]
    : action;
}

// The newest audit entries in the actor's scope (auditLogListWhere: superadmin
// all, ho their site, anyone else nothing). `details` is never selected: the
// feed shows who did what, not the payload. One query; the actor and location
// are left-joined so a row survives either side missing.
export async function loadAuditFeed(
  actor: ScopeActor,
  limit = 10,
): Promise<AuditFeedEntry[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actorName: user.name,
      locationName: siteLocation.name,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .leftJoin(siteLocation, eq(siteLocation.id, auditLog.siteLocationId))
    .where(auditLogListWhere(actor))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    label: auditActionLabel(row.action),
    actorName: row.actorName ?? "Unknown user",
    locationName: row.locationName,
    createdAt: row.createdAt.toISOString(),
  }));
}
