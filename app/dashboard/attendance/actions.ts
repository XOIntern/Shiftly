"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";

import {
  attendanceRecord,
  shiftDefinition,
  siteLocation,
  workArea,
  worker,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { GENERIC_ERROR } from "@/lib/action-state";
import { isFutureDate } from "@/lib/dates";
import { writableLocationId } from "@/lib/attendance-scope";
import { loadRosterRowsForDate } from "@/lib/attendance-data";
import { recordAttendanceAudit } from "@/lib/attendance-audit";
import type { ActionState } from "@/types/action-state";
import type { AttendanceStatus, RosterRowInput } from "@/types/attendance";
import type { Tx } from "@/types/db-tx";
import type { LocationTimezone } from "@/types/timezone";
import {
  addUnscheduledSchema,
  bulkRecordSchema,
  correctAttendanceSchema,
  recordAttendanceSchema,
  removeUnscheduledSchema,
} from "@/validation/attendance";

const ONLY_ADMINS = "Only admins record attendance";
const INVALID_INPUT = "Invalid attendance input";
const FUTURE_DATE = "Cannot record attendance for a future date";
const NOT_ON_ROSTER =
  "Worker is not on the roster that day; add an unscheduled row instead";
const ALREADY_RECORDED = "Already recorded, reload";
const TOO_MANY = "At most 500 rows per bulk entry";
const REASON_REQUIRED = "A reason is required";
const NOTHING_TO_CHANGE = "Nothing to change";
const CHANGED_MEANWHILE = "Attendance changed meanwhile, reload";
const RECORD_NOT_FOUND = "Attendance record not found.";
const WORKER_NOT_FOUND = "Worker not found.";
const NOT_AVAILABLE = "Shift or work area is not available at this location";
const ON_ROSTER =
  "Worker is on the roster that day; change the shift on the roster row";
const ONLY_UNSCHEDULED = "Only unscheduled rows can be removed";

const MAX_BULK_ROWS = 500;
// A list this long is refused before any parsing; the real cap is applied
// once duplicates collapse.
const MAX_BULK_INPUT = 10_000;
const MAX_REASON_LENGTH = 500;

type Actor = Awaited<ReturnType<typeof requireUser>>;
type Writable = { locationId: string; siteId: string };
type Located =
  | { ok: true; ctx: Writable; timezone: LocationTimezone }
  | { ok: false; result: ActionState };

// The location the session may write to: an admin's own, live. Everyone else,
// and an admin without a location, gets the role message.
async function locate(actor: Actor): Promise<Located> {
  const locationId = writableLocationId(actor);
  if (!locationId) {
    return { ok: false, result: { ok: false, message: ONLY_ADMINS } };
  }
  const [loc] = await db
    .select({
      siteId: siteLocation.siteId,
      timezone: siteLocation.timezone,
      deletedAt: siteLocation.deletedAt,
    })
    .from(siteLocation)
    .where(eq(siteLocation.id, locationId))
    .limit(1);
  if (!loc || loc.deletedAt) {
    return { ok: false, result: { ok: false, message: "Location not found." } };
  }
  return {
    ok: true,
    ctx: { locationId, siteId: loc.siteId },
    timezone: loc.timezone,
  };
}

// The checks every recording of a date shares, in the order a hostile or stale
// caller meets them: the role, the location, then the date against the
// location's own clock. "Today" is decided here from the location's time zone,
// never from anything the browser sent.
async function authorize(
  actor: Actor,
  date: string,
): Promise<{ ok: true; ctx: Writable } | { ok: false; result: ActionState }> {
  const located = await locate(actor);
  if (!located.ok) return located;
  if (isFutureDate(date, located.timezone, new Date())) {
    return { ok: false, result: { ok: false, message: FUTURE_DATE } };
  }
  return { ok: true, ctx: located.ctx };
}

// The mandatory reason of an audited change, trimmed. Blank is its own
// message; an oversized one is just invalid input.
function reasonOf(
  raw: unknown,
): { ok: true; reason: string } | { ok: false; result: ActionState } {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason === "") {
    return { ok: false, result: { ok: false, message: REASON_REQUIRED } };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, result: { ok: false, message: INVALID_INPUT } };
  }
  return { ok: true, reason };
}

// A shift or work area the location can still offer: its own, live and active.
async function shiftSelectable(
  tx: Tx,
  locationId: string,
  shiftId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: shiftDefinition.id })
    .from(shiftDefinition)
    .where(
      and(
        eq(shiftDefinition.id, shiftId),
        eq(shiftDefinition.siteLocationId, locationId),
        eq(shiftDefinition.isActive, true),
        isNull(shiftDefinition.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

async function areaSelectable(
  tx: Tx,
  locationId: string,
  areaId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: workArea.id })
    .from(workArea)
    .where(
      and(
        eq(workArea.id, areaId),
        eq(workArea.siteLocationId, locationId),
        eq(workArea.isActive, true),
        isNull(workArea.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

// First roster row per worker wins (weekly plan before the daily plan).
function rosterByWorker(rows: RosterRowInput[]): Map<string, RosterRowInput> {
  const byWorker = new Map<string, RosterRowInput>();
  for (const row of rows) {
    if (!byWorker.has(row.workerId)) byWorker.set(row.workerId, row);
  }
  return byWorker;
}

// First recording of one worker's row. Shift, work area and rostered shift
// always come from the roster recomputed inside the transaction, never from
// the client; the unique (worker, date) key tells a double recording from a
// first one. A first recording is not a correction, so it is not audited.
export async function recordAttendance(input: {
  date: string;
  workerId: string;
  status: AttendanceStatus;
}): Promise<ActionState> {
  const actor = await requireUser();
  if (actor.role !== "admin") return { ok: false, message: ONLY_ADMINS };

  const parsed = recordAttendanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_INPUT };
  const { date, workerId, status } = parsed.data;

  const auth = await authorize(actor, date);
  if (!auth.ok) return auth.result;
  const { locationId, siteId } = auth.ctx;

  try {
    const result = await db.transaction(async (tx): Promise<ActionState> => {
      const row = rosterByWorker(
        await loadRosterRowsForDate(locationId, date, tx),
      ).get(workerId);
      if (!row) return { ok: false, message: NOT_ON_ROSTER };

      const inserted = await tx
        .insert(attendanceRecord)
        .values({
          siteLocationId: locationId,
          siteId,
          workerId,
          date,
          shiftDefinitionId: row.shiftDefId,
          workAreaId: row.workAreaId,
          status,
          withoutRoster: false,
          rosteredShiftDefinitionId: row.shiftDefId,
          recordedBy: actor.id,
        })
        .onConflictDoNothing({
          target: [attendanceRecord.workerId, attendanceRecord.date],
        })
        .returning({ id: attendanceRecord.id });
      if (inserted.length === 0) return { ok: false, message: ALREADY_RECORDED };
      return { ok: true };
    });
    if (result.ok) revalidatePath("/dashboard/attendance");
    return result;
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// "Do what you can": the rostered, still unrecorded workers are recorded, the
// rest are skipped. applied = inserted, blocked = skipped (not on the roster
// that day, or already recorded). Duplicates collapse before the 500 cap.
export async function bulkRecord(input: {
  date: string;
  workerIds: string[];
  status: AttendanceStatus;
}): Promise<ActionState> {
  const actor = await requireUser();
  if (actor.role !== "admin") return { ok: false, message: ONLY_ADMINS };

  if (Array.isArray(input?.workerIds) && input.workerIds.length > MAX_BULK_INPUT) {
    return { ok: false, message: TOO_MANY };
  }
  const parsed = bulkRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_INPUT };
  const { date, status } = parsed.data;

  const workerIds = [...new Set(parsed.data.workerIds)];
  if (workerIds.length === 0) return { ok: false, message: INVALID_INPUT };
  if (workerIds.length > MAX_BULK_ROWS) return { ok: false, message: TOO_MANY };

  const auth = await authorize(actor, date);
  if (!auth.ok) return auth.result;
  const { locationId, siteId } = auth.ctx;

  try {
    const result = await db.transaction(async (tx): Promise<ActionState> => {
      const roster = rosterByWorker(
        await loadRosterRowsForDate(locationId, date, tx),
      );
      const rostered = workerIds.flatMap((workerId) => {
        const row = roster.get(workerId);
        return row ? [row] : [];
      });

      let applied = 0;
      if (rostered.length > 0) {
        const inserted = await tx
          .insert(attendanceRecord)
          .values(
            rostered.map((row) => ({
              siteLocationId: locationId,
              siteId,
              workerId: row.workerId,
              date,
              shiftDefinitionId: row.shiftDefId,
              workAreaId: row.workAreaId,
              status,
              withoutRoster: false,
              rosteredShiftDefinitionId: row.shiftDefId,
              recordedBy: actor.id,
            })),
          )
          .onConflictDoNothing({
            target: [attendanceRecord.workerId, attendanceRecord.date],
          })
          .returning({ id: attendanceRecord.id });
        applied = inserted.length;
      }
      return { ok: true, applied, blocked: workerIds.length - applied };
    });
    if (result.ok) revalidatePath("/dashboard/attendance");
    return result;
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// Changes a recorded row's status and/or the shift actually worked. The
// update only lands while the row still holds what the Admin saw on screen
// (expectedStatus / expectedShiftDefinitionId): a row someone else changed
// meanwhile answers "reload" instead of being silently overwritten. The audit
// row (old -> new, the reason, the actor) is written in the same transaction,
// so a failed audit undoes the change. A correction never moves the work area.
export async function correctAttendance(input: {
  recordId: string;
  expectedStatus: AttendanceStatus;
  expectedShiftDefinitionId: string;
  status?: AttendanceStatus;
  shiftDefinitionId?: string;
  reason: string;
}): Promise<ActionState> {
  const actor = await requireUser();
  if (actor.role !== "admin") return { ok: false, message: ONLY_ADMINS };

  const parsed = correctAttendanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_INPUT };
  const reason = reasonOf(input.reason);
  if (!reason.ok) return reason.result;

  const { recordId, expectedStatus, expectedShiftDefinitionId } = parsed.data;
  const status = parsed.data.status ?? expectedStatus;
  const shiftDefinitionId =
    parsed.data.shiftDefinitionId ?? expectedShiftDefinitionId;
  if (
    status === expectedStatus &&
    shiftDefinitionId === expectedShiftDefinitionId
  ) {
    return { ok: false, message: NOTHING_TO_CHANGE };
  }

  const located = await locate(actor);
  if (!located.ok) return located.result;
  const { locationId, siteId } = located.ctx;

  try {
    const result = await db.transaction(async (tx): Promise<ActionState> => {
      const [record] = await tx
        .select({
          workerId: attendanceRecord.workerId,
          date: attendanceRecord.date,
        })
        .from(attendanceRecord)
        .where(
          and(
            eq(attendanceRecord.id, recordId),
            eq(attendanceRecord.siteLocationId, locationId),
          ),
        )
        .limit(1);
      if (!record) return { ok: false, message: RECORD_NOT_FOUND };

      if (
        shiftDefinitionId !== expectedShiftDefinitionId &&
        !(await shiftSelectable(tx, locationId, shiftDefinitionId))
      ) {
        return { ok: false, message: NOT_AVAILABLE };
      }

      const updated = await tx
        .update(attendanceRecord)
        .set({ status, shiftDefinitionId })
        .where(
          and(
            eq(attendanceRecord.id, recordId),
            eq(attendanceRecord.siteLocationId, locationId),
            eq(attendanceRecord.status, expectedStatus),
            eq(attendanceRecord.shiftDefinitionId, expectedShiftDefinitionId),
          ),
        )
        .returning({ id: attendanceRecord.id });
      if (updated.length === 0) return { ok: false, message: CHANGED_MEANWHILE };

      await recordAttendanceAudit(tx, {
        actorId: actor.id,
        action: "attendance.correct",
        siteId,
        siteLocationId: locationId,
        details: {
          recordId,
          workerId: record.workerId,
          date: record.date,
          old: {
            status: expectedStatus,
            shiftDefinitionId: expectedShiftDefinitionId,
          },
          new: { status, shiftDefinitionId },
          reason: reason.reason,
        },
      });
      return { ok: true };
    });
    if (result.ok) revalidatePath("/dashboard/attendance");
    return result;
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// Records a worker who is not on the roster that day, with a reason. The
// worker must be a live, active worker of this location and the shift and
// area live and active here; a worker who IS on the roster is changed on the
// roster row instead. Audited in the same transaction.
export async function addUnscheduled(input: {
  date: string;
  workerId: string;
  workAreaId: string;
  shiftDefinitionId: string;
  status: AttendanceStatus;
  reason: string;
}): Promise<ActionState> {
  const actor = await requireUser();
  if (actor.role !== "admin") return { ok: false, message: ONLY_ADMINS };

  const parsed = addUnscheduledSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_INPUT };
  const reason = reasonOf(input.reason);
  if (!reason.ok) return reason.result;
  const { date, workerId, workAreaId, shiftDefinitionId, status } = parsed.data;

  const auth = await authorize(actor, date);
  if (!auth.ok) return auth.result;
  const { locationId, siteId } = auth.ctx;

  try {
    const result = await db.transaction(async (tx): Promise<ActionState> => {
      const [candidate] = await tx
        .select({ id: worker.id })
        .from(worker)
        .where(
          and(
            eq(worker.id, workerId),
            eq(worker.siteLocationId, locationId),
            eq(worker.isActive, true),
            isNull(worker.deletedAt),
          ),
        )
        .limit(1);
      if (!candidate) return { ok: false, message: WORKER_NOT_FOUND };

      const onRoster = rosterByWorker(
        await loadRosterRowsForDate(locationId, date, tx),
      ).has(workerId);
      if (onRoster) return { ok: false, message: ON_ROSTER };

      if (
        !(await shiftSelectable(tx, locationId, shiftDefinitionId)) ||
        !(await areaSelectable(tx, locationId, workAreaId))
      ) {
        return { ok: false, message: NOT_AVAILABLE };
      }

      const [inserted] = await tx
        .insert(attendanceRecord)
        .values({
          siteLocationId: locationId,
          siteId,
          workerId,
          date,
          shiftDefinitionId,
          workAreaId,
          status,
          withoutRoster: true,
          rosteredShiftDefinitionId: null,
          reason: reason.reason,
          recordedBy: actor.id,
        })
        .onConflictDoNothing({
          target: [attendanceRecord.workerId, attendanceRecord.date],
        })
        .returning({ id: attendanceRecord.id });
      if (!inserted) return { ok: false, message: ALREADY_RECORDED };

      await recordAttendanceAudit(tx, {
        actorId: actor.id,
        action: "attendance.unscheduled.add",
        siteId,
        siteLocationId: locationId,
        details: {
          recordId: inserted.id,
          workerId,
          date,
          shiftDefinitionId,
          workAreaId,
          status,
          reason: reason.reason,
        },
      });
      return { ok: true };
    });
    if (result.ok) revalidatePath("/dashboard/attendance");
    return result;
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}

// Removes a mistaken unscheduled row. Only unscheduled rows can go: a roster
// row is corrected, never deleted. The audit entry keeps a snapshot of the
// deleted row, written in the same transaction.
export async function removeUnscheduled(input: {
  recordId: string;
  reason: string;
}): Promise<ActionState> {
  const actor = await requireUser();
  if (actor.role !== "admin") return { ok: false, message: ONLY_ADMINS };

  const parsed = removeUnscheduledSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: INVALID_INPUT };
  const reason = reasonOf(input.reason);
  if (!reason.ok) return reason.result;
  const { recordId } = parsed.data;

  const located = await locate(actor);
  if (!located.ok) return located.result;
  const { locationId, siteId } = located.ctx;

  try {
    const result = await db.transaction(async (tx): Promise<ActionState> => {
      const [record] = await tx
        .select({ withoutRoster: attendanceRecord.withoutRoster })
        .from(attendanceRecord)
        .where(
          and(
            eq(attendanceRecord.id, recordId),
            eq(attendanceRecord.siteLocationId, locationId),
          ),
        )
        .limit(1);
      if (!record) return { ok: false, message: RECORD_NOT_FOUND };
      if (!record.withoutRoster) return { ok: false, message: ONLY_UNSCHEDULED };

      const [deleted] = await tx
        .delete(attendanceRecord)
        .where(
          and(
            eq(attendanceRecord.id, recordId),
            eq(attendanceRecord.siteLocationId, locationId),
            eq(attendanceRecord.withoutRoster, true),
          ),
        )
        .returning();
      if (!deleted) return { ok: false, message: CHANGED_MEANWHILE };

      await recordAttendanceAudit(tx, {
        actorId: actor.id,
        action: "attendance.unscheduled.remove",
        siteId,
        siteLocationId: locationId,
        details: { recordId, reason: reason.reason, snapshot: deleted },
      });
      return { ok: true };
    });
    if (result.ok) revalidatePath("/dashboard/attendance");
    return result;
  } catch {
    return { ok: false, message: GENERIC_ERROR };
  }
}
