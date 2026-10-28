"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { attendanceRecord, siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { GENERIC_ERROR } from "@/lib/action-state";
import { isFutureDate } from "@/lib/dates";
import { writableLocationId } from "@/lib/attendance-scope";
import { loadRosterRowsForDate } from "@/lib/attendance-data";
import type { ActionState } from "@/types/action-state";
import type { AttendanceStatus, RosterRowInput } from "@/types/attendance";
import {
  bulkRecordSchema,
  recordAttendanceSchema,
} from "@/validation/attendance";

const ONLY_ADMINS = "Only admins record attendance";
const INVALID_INPUT = "Invalid attendance input";
const FUTURE_DATE = "Cannot record attendance for a future date";
const NOT_ON_ROSTER =
  "Worker is not on the roster that day; add an unscheduled row instead";
const ALREADY_RECORDED = "Already recorded, reload";
const TOO_MANY = "At most 500 rows per bulk entry";

const MAX_BULK_ROWS = 500;
// A list this long is refused before any parsing; the real cap is applied
// once duplicates collapse.
const MAX_BULK_INPUT = 10_000;

type Writable = { locationId: string; siteId: string };

// The checks every recording shares, in the order a hostile or stale caller
// meets them: the role, the location the session may write to, the date, and
// the date against the location's own clock. "Today" is decided here from the
// location's time zone, never from anything the browser sent.
async function authorize(
  actor: Awaited<ReturnType<typeof requireUser>>,
  date: string,
): Promise<{ ok: true; ctx: Writable } | { ok: false; result: ActionState }> {
  const locationId = writableLocationId(actor);
  if (!locationId) return { ok: false, result: { ok: false, message: ONLY_ADMINS } };

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
  if (isFutureDate(date, loc.timezone, new Date())) {
    return { ok: false, result: { ok: false, message: FUTURE_DATE } };
  }
  return { ok: true, ctx: { locationId, siteId: loc.siteId } };
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
