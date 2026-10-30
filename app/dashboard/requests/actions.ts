"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { z } from "zod";

import {
  mpRequest,
  mpRequestLine,
  position,
  shiftDefinition,
  siteLocation,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { pgErrorConstraint, pgErrorCode } from "@/error/db-errors";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import type {
  MpRequestLineView,
  RequestedWeek,
  RequestedWeekStatus,
} from "@/types/mp-request";
import { dayNumber } from "@/lib/dates";
import { mergeRequestLines } from "@/lib/mp-request-lines";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { weekDates } from "@/lib/week";
import {
  mpRequestListWhere,
  mpRequestMutationWhere,
} from "@/lib/mp-request-scope";
import { recordMpRequestAudit } from "@/lib/mp-request-audit";
import { requestMutability } from "@/lib/mp-request-lock";
import {
  mpRequestCreateSchema,
  mpRequestLineSchema,
  withdrawRequestSchema,
  type MpRequestCreateInput,
  type MpRequestLineInput,
} from "@/validation/request-line";

// Thrown to abort one of the actions' transactions with an already-built
// ActionState: a returned value would commit the half-done write — a throw
// is the only rollback (pattern: updateWorker's WorkerNotFoundError).
class ActionAbort extends Error {
  constructor(readonly state: ActionState) {
    super("action aborted");
  }
}

// Messages the tests assert verbatim.
const HO_CREATE_MESSAGE = "Only admins enter requests";
const DUPLICATE_SLOT = "A request for this week/date already exists";
const NOT_EDITABLE = "This request can no longer be edited.";
const WEEK_HAS_ROSTER =
  "This week already has a roster. Discard the draft roster first.";
const RACE_MESSAGE = "Request state changed, reload";
const NOT_FOUND = "Request not found.";
const HO_WITHDRAW_MESSAGE = "HO cannot withdraw requests.";
const NOT_WITHDRAWABLE = "This request can no longer be withdrawn.";
// The composite weld FKs on mp_request_line (work area / shift +
// site_location + site) make a cross-location pairing impossible — this is
// both the pre-check's message for a foreign reference and the catch's net
// when a row vanishes or moves between the check and the write.
const REFERENCE_FK =
  "Selected work area, shift or position must belong to this request's location";
const REFERENCE_GONE = "Selected work area, shift or position no longer exists";
const LINE_DUPLICATE =
  "Duplicate work area, shift, position and date combination";
const INACTIVE_WA_KEEP_ONLY =
  "Inactive work areas can only be kept unchanged, not re-added";
const INACTIVE_SHIFT_KEEP_ONLY =
  "Inactive shifts can only be kept unchanged, not re-added";
const POSITION_NOT_REQUIRED =
  "Position must be a required position of the work area";
const INACTIVE_POSITION_KEEP_ONLY =
  "Inactive positions can only be kept unchanged, not re-added";

// Admin actors are pinned to their own site_location — anything the client
// sent is ignored. A superadmin keeps the input value (the dialog's pick).
function effectiveSiteLocationId(
  actor: SessionUser,
  inputSiteLocationId: string | undefined,
): string | undefined {
  return actor.role === "admin"
    ? (actor.siteLocationId ?? undefined)
    : inputSiteLocationId;
}

// siteId is NEVER trusted from the client: it is derived from the request's
// site_location, so the composite FK pairing is decided server-side. A
// soft-deleted location cannot parent a request (live-row weld).
async function deriveSiteId(siteLocationId: string): Promise<string | null> {
  const [row] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(
      and(eq(siteLocation.id, siteLocationId), isNull(siteLocation.deletedAt)),
    )
    .limit(1);
  return row ? row.siteId : null;
}

// Maps a driver error to the action result shape. The two 23505 shapes
// differ per constraint: the request's open-slot partial indexes answer the
// friendly plan message, a line-set duplicate is a per-field error on
// `lines`. FK violations surface as the weld net; anything unexpected falls
// back to the generic error.
function requestResult(err: unknown): ActionState {
  const code = pgErrorCode(err);
  if (code === "23505") {
    const constraint = pgErrorConstraint(err);
    if (
      constraint ===
      "mp_request_line_request_work_area_shift_position_date_unique"
    ) {
      return { ok: false, fieldErrors: { lines: LINE_DUPLICATE } };
    }
    return { ok: false, message: DUPLICATE_SLOT };
  }
  if (code === "23503" || code === "23001") {
    return { ok: false, message: REFERENCE_FK };
  }
  return { ok: false, message: GENERIC_ERROR };
}

// Business check shared by create and update: every referenced work area,
// shift and position must be live, belong to the request's site/location
// and be active — and the position must be a required position of its work
// area (the work_area_position pivot, #135). An inactive reference is
// acceptable ONLY when the edit keeps that exact line unchanged (spec
// Review Focus #5: keep-or-remove allowed, re-add forbidden) — `keep`
// carries the stored line set for that compare; create passes none, so any
// inactive reference fails there. The DB's welded FKs back-stop every
// forged pairing this check screens for.
async function checkLineReferences(
  lines: MpRequestLineInput[],
  siteLocationId: string,
  siteId: string,
  keep?: MpRequestLineInput[],
): Promise<{ ok: true } | { abort: ActionState }> {
  const waIds = [...new Set(lines.map((line) => line.workAreaId))];
  const shiftIds = [...new Set(lines.map((line) => line.shiftDefinitionId))];
  const positionIds = [...new Set(lines.map((line) => line.positionId))];

  const [was, shifts, positions, pivotPairs] = await Promise.all([
    db
      .select({
        id: workArea.id,
        siteLocationId: workArea.siteLocationId,
        isActive: workArea.isActive,
        deletedAt: workArea.deletedAt,
      })
      .from(workArea)
      .where(inArray(workArea.id, waIds)),
    db
      .select({
        id: shiftDefinition.id,
        siteLocationId: shiftDefinition.siteLocationId,
        isActive: shiftDefinition.isActive,
        deletedAt: shiftDefinition.deletedAt,
      })
      .from(shiftDefinition)
      .where(inArray(shiftDefinition.id, shiftIds)),
    db
      .select({
        id: position.id,
        siteId: position.siteId,
        isActive: position.isActive,
        deletedAt: position.deletedAt,
      })
      .from(position)
      .where(inArray(position.id, positionIds)),
    db
      .select({
        workAreaId: workAreaPosition.workAreaId,
        positionId: workAreaPosition.positionId,
      })
      .from(workAreaPosition)
      .where(inArray(workAreaPosition.workAreaId, waIds)),
  ]);
  const waById = new Map(was.map((row) => [row.id, row]));
  const shiftById = new Map(shifts.map((row) => [row.id, row]));
  const positionById = new Map(positions.map((row) => [row.id, row]));
  const requiredPairs = new Set(
    pivotPairs.map((pair) => `${pair.workAreaId}|${pair.positionId}`),
  );

  // "Kept unchanged" means the exact tuple survives the edit.
  const keptKeys = new Set(
    (keep ?? []).map((line) => lineKey(line)),
  );

  for (const line of lines) {
    const wa = waById.get(line.workAreaId);
    const shift = shiftById.get(line.shiftDefinitionId);
    const pos = positionById.get(line.positionId);
    // The weld FKs match soft-deleted rows too, so liveness is judged here:
    // a deleted reference is as good as a missing one.
    if (
      !wa ||
      wa.deletedAt ||
      !shift ||
      shift.deletedAt ||
      !pos ||
      pos.deletedAt
    ) {
      return { abort: { ok: false, message: REFERENCE_GONE } };
    }
    if (
      wa.siteLocationId !== siteLocationId ||
      shift.siteLocationId !== siteLocationId ||
      pos.siteId !== siteId
    ) {
      return { abort: { ok: false, message: REFERENCE_FK } };
    }
    // A position the area does not draw from is refused outright — even
    // live and same-site (#135).
    if (!requiredPairs.has(`${line.workAreaId}|${line.positionId}`)) {
      return {
        abort: { ok: false, fieldErrors: { lines: POSITION_NOT_REQUIRED } },
      };
    }
    if (!wa.isActive && !keptKeys.has(lineKey(line))) {
      return { abort: { ok: false, fieldErrors: { lines: INACTIVE_WA_KEEP_ONLY } } };
    }
    if (!shift.isActive && !keptKeys.has(lineKey(line))) {
      return { abort: { ok: false, fieldErrors: { lines: INACTIVE_SHIFT_KEEP_ONLY } } };
    }
    if (!pos.isActive && !keptKeys.has(lineKey(line))) {
      return {
        abort: {
          ok: false,
          fieldErrors: { lines: INACTIVE_POSITION_KEEP_ONLY },
        },
      };
    }
  }
  return { ok: true };
}

const lineKey = (line: MpRequestLineInput) =>
  `${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}|${line.date}|${line.headcount}`;

function lineValues(
  requestId: string,
  siteId: string,
  siteLocationId: string,
  lines: MpRequestLineInput[],
) {
  return lines.map((line) => ({
    requestId,
    siteId,
    siteLocationId,
    workAreaId: line.workAreaId,
    shiftDefinitionId: line.shiftDefinitionId,
    positionId: line.positionId,
    date: line.date,
    headcount: line.headcount,
  }));
}

export async function createRequest(
  input: MpRequestCreateInput,
): Promise<ActionState> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_CREATE_MESSAGE };
  }

  const parsed = mpRequestCreateSchema.safeParse({
    // Ignored — derived from the site_location below.
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    type: input.type,
    weekStart: input.weekStart,
    requestDate: input.requestDate,
    lines: input.lines,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // An unbound admin fails closed at the field, not at the DB. The schema's
  // refine has already validated anchors and line dates against each other;
  // the stored-anchor re-check exists only for updateRequestLines.
  const siteLocationId = parsed.data.siteLocationId;
  if (!siteLocationId) {
    return { ok: false, fieldErrors: { siteLocationId: "Location is required" } };
  }

  const derivedSiteId = await deriveSiteId(siteLocationId);
  if (!derivedSiteId) {
    return { ok: false, fieldErrors: { siteLocationId: "Location not found." } };
  }

  // Create has no stored lines: every inactive reference is a fresh add.
  const references = await checkLineReferences(
    parsed.data.lines,
    siteLocationId,
    derivedSiteId,
  );
  if ("abort" in references) return references.abort;

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mpRequest)
        .values({
          siteId: derivedSiteId,
          siteLocationId,
          type: parsed.data.type,
          // No approval step: a weekly request is live from the start,
          // a daily one waits as open until a fill consumes it.
          status: parsed.data.type === "weekly" ? "approved" : "open",
          weekStart: parsed.data.weekStart ?? null,
          requestDate: parsed.data.requestDate ?? null,
          createdBy: actor.id,
        })
        .returning({ id: mpRequest.id });

      await tx
        .insert(mpRequestLine)
        .values(lineValues(row.id, derivedSiteId, siteLocationId, parsed.data.lines));

      // Audit in the SAME transaction as the write.
      await recordMpRequestAudit(tx, {
        actorId: actor.id,
        action: "mp_request.create",
        siteId: derivedSiteId,
        siteLocationId,
        details: {
          requestId: row.id,
          type: parsed.data.type,
          status: parsed.data.type === "weekly" ? "approved" : "open",
          lineCount: parsed.data.lines.length,
        },
      });
    });
  } catch (err) {
    return requestResult(err);
  }

  revalidatePath("/dashboard/requests");
  return { ok: true };
}

export async function updateRequestLines(
  id: string,
  lines: MpRequestLineInput[],
): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: NOT_FOUND };
  }

  const parsed = z.array(mpRequestLineSchema).min(1).safeParse(lines);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Ownership weld rides inside the row read, and the row is locked so
      // the delete+reinsert cannot race a status change.
      const [row] = await tx
        .select({
          id: mpRequest.id,
          type: mpRequest.type,
          status: mpRequest.status,
          weekStart: mpRequest.weekStart,
          requestDate: mpRequest.requestDate,
          siteId: mpRequest.siteId,
          siteLocationId: mpRequest.siteLocationId,
        })
        .from(mpRequest)
        .where(mpRequestMutationWhere(actor, id))
        .limit(1)
        .for("update");
      if (!row) throw new ActionAbort({ ok: false, message: NOT_FOUND });
      // Read under the row lock, so a plan generated a moment ago is seen.
      const mutability = await requestMutability(tx, row);
      if (mutability !== "mutable") {
        throw new ActionAbort({
          ok: false,
          message: mutability === "rostered" ? WEEK_HAS_ROSTER : NOT_EDITABLE,
        });
      }

      // Anchor/type are immutable after creation: the new line dates are
      // re-checked against the STORED anchor server-side.
      const allowedDates = new Set(
        row.type === "weekly"
          ? weekDates(row.weekStart as string)
          : [row.requestDate as string],
      );
      const badIndex = parsed.data.findIndex((line) => !allowedDates.has(line.date));
      if (badIndex >= 0) {
        throw new ActionAbort({
          ok: false,
          fieldErrors: {
            [`lines.${badIndex}.date`]:
              row.type === "weekly"
                ? "Line date must fall within the request week"
                : "Every line must share the request date",
          },
        });
      }

      // Stored lines drive the keep-unchanged compare and the audit counts.
      const storedLines: MpRequestLineInput[] = await tx
        .select({
          workAreaId: mpRequestLine.workAreaId,
          shiftDefinitionId: mpRequestLine.shiftDefinitionId,
          positionId: mpRequestLine.positionId,
          date: mpRequestLine.date,
          headcount: mpRequestLine.headcount,
        })
        .from(mpRequestLine)
        .where(eq(mpRequestLine.requestId, id));

      const references = await checkLineReferences(
        parsed.data,
        row.siteLocationId,
        row.siteId,
        storedLines,
      );
      if ("abort" in references) throw new ActionAbort(references.abort);

      // One transaction: delete-all + reinsert + updatedAt bump.
      await tx.delete(mpRequestLine).where(eq(mpRequestLine.requestId, id));
      await tx
        .insert(mpRequestLine)
        .values(lineValues(id, row.siteId, row.siteLocationId, parsed.data));
      await tx
        .update(mpRequest)
        .set({ updatedAt: new Date() })
        .where(eq(mpRequest.id, id));

      await recordMpRequestAudit(tx, {
        actorId: actor.id,
        action: "mp_request.update",
        siteId: row.siteId,
        siteLocationId: row.siteLocationId,
        details: {
          requestId: id,
          oldLineCount: storedLines.length,
          newLineCount: parsed.data.length,
        },
      });

      return { ok: true } as ActionState;
    });

    revalidatePath("/dashboard/requests");
    return result;
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return requestResult(err);
  }
}

// Withdrawal is the requester's retraction of a request that is still
// mutable: admins (pinned to their own location by the scope) and superadmin.
// HO has no write surface here, so it is refused before any read. A weekly
// request stops being withdrawable once its week has a roster plan.
export async function withdrawRequest(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_WITHDRAW_MESSAGE };
  }

  const parsed = withdrawRequestSchema.safeParse({ id });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          status: mpRequest.status,
          type: mpRequest.type,
          weekStart: mpRequest.weekStart,
          siteId: mpRequest.siteId,
          siteLocationId: mpRequest.siteLocationId,
        })
        .from(mpRequest)
        .where(mpRequestMutationWhere(actor, parsed.data.id))
        .limit(1)
        .for("update");
      if (!row) throw new ActionAbort({ ok: false, message: NOT_FOUND });

      const mutability = await requestMutability(tx, row);
      if (mutability !== "mutable") {
        throw new ActionAbort({
          ok: false,
          message:
            mutability === "rostered" ? WEEK_HAS_ROSTER : NOT_WITHDRAWABLE,
        });
      }

      // Guarded write: a concurrent status move turns this into a 0-row no-op.
      const updated = await tx
        .update(mpRequest)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(mpRequest.id, parsed.data.id),
            eq(mpRequest.status, row.status),
          ),
        )
        .returning({ id: mpRequest.id });
      if (updated.length === 0) {
        throw new ActionAbort({ ok: false, message: RACE_MESSAGE });
      }

      await recordMpRequestAudit(tx, {
        actorId: actor.id,
        action: "mp_request.status_change",
        siteId: row.siteId,
        siteLocationId: row.siteLocationId,
        details: {
          requestId: parsed.data.id,
          type: row.type,
          oldValue: row.status,
          newValue: "withdrawn",
        },
      });

      return { ok: true } as ActionState;
    });

    revalidatePath("/dashboard/requests");
    revalidatePath("/dashboard/roster");
    return result;
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return { ok: false, message: GENERIC_ERROR };
  }
}

// Read-only lookup behind "copy from last week": the most recent week before
// the given one in which the actor has a live (open, approved or fulfilled)
// weekly request at that location, returned as the merged lines of every
// live weekly request of that week (a fulfilled request plus a later delta
// request read as one demand). Rejected and withdrawn requests are void and
// never count, so a week holding only those is skipped. Network-reachable, so
// it authenticates and scopes like the writes; anything malformed or out of
// scope is simply "no source".
export async function loadCopySource(
  siteLocationId: string,
  beforeWeekStart: string,
): Promise<{ weekStart: string; lines: MpRequestLineView[] } | null> {
  const actor = await requireUser();

  if (
    !z.uuid().safeParse(siteLocationId).success ||
    !z.iso.date().safeParse(beforeWeekStart).success
  ) {
    return null;
  }

  const sourceWhere = and(
    mpRequestListWhere(actor),
    eq(mpRequest.siteLocationId, siteLocationId),
    eq(mpRequest.type, "weekly"),
    inArray(mpRequest.status, ["open", "approved", "fulfilled"]),
  );
  const [source] = await db
    .select({ weekStart: mpRequest.weekStart })
    .from(mpRequest)
    .where(and(sourceWhere, lt(mpRequest.weekStart, beforeWeekStart)))
    .orderBy(desc(mpRequest.weekStart))
    .limit(1);
  if (!source?.weekStart) return null;

  const lines: MpRequestLineView[] = await db
    .select({
      workAreaId: mpRequestLine.workAreaId,
      workAreaName: workArea.name,
      shiftDefinitionId: mpRequestLine.shiftDefinitionId,
      shiftLabel: shiftDefinition.label,
      positionId: mpRequestLine.positionId,
      positionName: position.name,
      date: mpRequestLine.date,
      headcount: mpRequestLine.headcount,
    })
    .from(mpRequestLine)
    .innerJoin(mpRequest, eq(mpRequestLine.requestId, mpRequest.id))
    .innerJoin(workArea, eq(mpRequestLine.workAreaId, workArea.id))
    .innerJoin(
      shiftDefinition,
      eq(mpRequestLine.shiftDefinitionId, shiftDefinition.id),
    )
    .innerJoin(position, eq(mpRequestLine.positionId, position.id))
    .where(and(sourceWhere, eq(mpRequest.weekStart, source.weekStart)));

  return { weekStart: source.weekStart, lines: mergeRequestLines(lines) };
}

// The widest window the week-start calendar may ask for: a six-row month grid
// spans 42 days, so this leaves slack without letting a forged call scan the
// whole table.
const MAX_REQUESTED_WEEKS_SPAN_DAYS = 62;

// The shared gate of the calendar lookups: a uuid location and an ordered
// pair of ISO dates no wider than the cap.
function isCalendarWindow(
  siteLocationId: string,
  from: string,
  to: string,
): boolean {
  if (
    !z.uuid().safeParse(siteLocationId).success ||
    !z.iso.date().safeParse(from).success ||
    !z.iso.date().safeParse(to).success
  ) {
    return false;
  }
  const span = dayNumber(to) - dayNumber(from);
  return span >= 0 && span <= MAX_REQUESTED_WEEKS_SPAN_DAYS;
}

// Read-only lookup behind the week-start calendar's markers: the Mondays in
// [from, to] (inclusive) on which the location holds a live (open, approved or
// fulfilled) weekly request, ascending. A week holding a fulfilled request and
// a later open or approved one reads as the latter — only that one holds the
// DB slot. Rejected, withdrawn and daily requests never mark a week. Scoped
// like loadCopySource; anything malformed, reversed, wider than
// MAX_REQUESTED_WEEKS_SPAN_DAYS or out of scope is simply "no weeks".
export async function loadRequestedWeeks(
  siteLocationId: string,
  from: string,
  to: string,
): Promise<RequestedWeek[]> {
  const actor = await requireUser();

  if (!isCalendarWindow(siteLocationId, from, to)) return [];

  const rows = await db
    .select({ weekStart: mpRequest.weekStart, status: mpRequest.status })
    .from(mpRequest)
    .where(
      and(
        mpRequestListWhere(actor),
        eq(mpRequest.siteLocationId, siteLocationId),
        eq(mpRequest.type, "weekly"),
        inArray(mpRequest.status, ["open", "approved", "fulfilled"]),
        gte(mpRequest.weekStart, from),
        lte(mpRequest.weekStart, to),
      ),
    )
    .orderBy(asc(mpRequest.weekStart));

  const byWeek = new Map<string, RequestedWeekStatus>();
  for (const row of rows) {
    if (!row.weekStart) continue;
    const status = row.status as RequestedWeekStatus;
    if (byWeek.get(row.weekStart) !== undefined && status === "fulfilled") continue;
    byWeek.set(row.weekStart, status);
  }
  return [...byWeek].map(([weekStart, status]) => ({ weekStart, status }));
}

// Read-only lookup behind the daily calendars' markers: the dates in
// [from, to] (inclusive) on which the location holds an open daily request,
// ascending — the statuses that hold the one-per-date DB slot. Fulfilled,
// rejected, withdrawn and weekly requests never mark a day. Scoped and guarded
// exactly like loadRequestedWeeks.
export async function loadRequestedDays(
  siteLocationId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const actor = await requireUser();

  if (!isCalendarWindow(siteLocationId, from, to)) return [];

  const rows = await db
    .select({ requestDate: mpRequest.requestDate })
    .from(mpRequest)
    .where(
      and(
        mpRequestListWhere(actor),
        eq(mpRequest.siteLocationId, siteLocationId),
        eq(mpRequest.type, "daily"),
        inArray(mpRequest.status, ["open", "approved"]),
        gte(mpRequest.requestDate, from),
        lte(mpRequest.requestDate, to),
      ),
    )
    .orderBy(asc(mpRequest.requestDate));

  return rows.flatMap((row) => (row.requestDate ? [row.requestDate] : []));
}
