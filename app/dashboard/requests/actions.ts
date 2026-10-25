"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  mpRequest,
  mpRequestLine,
  mpRequestStatusEnum,
  shiftDefinition,
  siteLocation,
  workArea,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { pgErrorConstraint, pgErrorCode } from "@/error/db-errors";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { weekDates } from "@/lib/week";
import { mpRequestMutationWhere } from "@/lib/mp-request-scope";
import { recordMpRequestAudit } from "@/lib/mp-request-audit";
import {
  advanceStatusSchema,
  mpRequestCreateSchema,
  mpRequestLineSchema,
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

type MpRequestStatus = (typeof mpRequestStatusEnum.enumValues)[number];

// Messages pinned by the plan — the tests assert them verbatim.
const HO_CREATE_MESSAGE = "Only admins enter requests";
const DUPLICATE_OPEN_SLOT =
  "An open request for this week/date already exists";
const NOT_EDITABLE = "Only submitted requests can be edited";
const RACE_MESSAGE = "Request state changed, reload";
const NOT_FOUND = "Request not found.";
const ILLEGAL_TRANSITION = "That status change is not allowed";
// The composite weld FKs on mp_request_line (work area / shift +
// site_location + site) make a cross-location pairing impossible — this is
// both the pre-check's message for a foreign reference and the catch's net
// when a row vanishes or moves between the check and the write.
const REFERENCE_FK =
  "Selected work area or shift must belong to this request's location";
const REFERENCE_GONE = "Selected work area or shift no longer exists";
const LINE_DUPLICATE = "Duplicate work area, shift and date combination";
const INACTIVE_WA_KEEP_ONLY =
  "Inactive work areas can only be kept unchanged, not re-added";
const INACTIVE_SHIFT_KEEP_ONLY =
  "Inactive shifts can only be kept unchanged, not re-added";

// Manual status machine (spec §4.4): forward-only edges, terminal states
// stay terminal. The guarded write below still re-checks the CURRENT row
// status in its WHERE, so a concurrent move turns this into a 0-row no-op.
const LEGAL_TRANSITIONS: Record<MpRequestStatus, readonly string[]> = {
  submitted: ["received"],
  received: ["processing"],
  processing: ["fulfilled", "rejected"],
  fulfilled: [],
  rejected: [],
};

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
    if (constraint === "mp_request_line_request_work_area_shift_date_unique") {
      return { ok: false, fieldErrors: { lines: LINE_DUPLICATE } };
    }
    return { ok: false, message: DUPLICATE_OPEN_SLOT };
  }
  if (code === "23503" || code === "23001") {
    return { ok: false, message: REFERENCE_FK };
  }
  return { ok: false, message: GENERIC_ERROR };
}

// Business check shared by create and update: every referenced work area and
// shift must be live, belong to the request's location and be active. An
// inactive reference is acceptable ONLY when the edit keeps that exact line
// unchanged (spec Review Focus #5: keep-or-remove allowed, re-add
// forbidden) — `keep` carries the stored line set for that compare; create
// passes none, so any inactive reference fails there.
async function checkLineReferences(
  lines: MpRequestLineInput[],
  siteLocationId: string,
  keep?: MpRequestLineInput[],
): Promise<{ ok: true } | { abort: ActionState }> {
  const waIds = [...new Set(lines.map((line) => line.workAreaId))];
  const shiftIds = [...new Set(lines.map((line) => line.shiftDefinitionId))];

  const [was, shifts] = await Promise.all([
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
  ]);
  const waById = new Map(was.map((row) => [row.id, row]));
  const shiftById = new Map(shifts.map((row) => [row.id, row]));

  // "Kept unchanged" means the exact tuple survives the edit.
  const keptKeys = new Set(
    (keep ?? []).map((line) => lineKey(line)),
  );

  for (const line of lines) {
    const wa = waById.get(line.workAreaId);
    const shift = shiftById.get(line.shiftDefinitionId);
    // The weld FKs match soft-deleted rows too, so liveness is judged here:
    // a deleted reference is as good as a missing one.
    if (!wa || wa.deletedAt || !shift || shift.deletedAt) {
      return { abort: { ok: false, message: REFERENCE_GONE } };
    }
    if (wa.siteLocationId !== siteLocationId || shift.siteLocationId !== siteLocationId) {
      return { abort: { ok: false, message: REFERENCE_FK } };
    }
    if (!wa.isActive && !keptKeys.has(lineKey(line))) {
      return { abort: { ok: false, fieldErrors: { lines: INACTIVE_WA_KEEP_ONLY } } };
    }
    if (!shift.isActive && !keptKeys.has(lineKey(line))) {
      return { abort: { ok: false, fieldErrors: { lines: INACTIVE_SHIFT_KEEP_ONLY } } };
    }
  }
  return { ok: true };
}

const lineKey = (line: MpRequestLineInput) =>
  `${line.workAreaId}|${line.shiftDefinitionId}|${line.date}|${line.headcount}`;

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
  const references = await checkLineReferences(parsed.data.lines, siteLocationId);
  if ("abort" in references) return references.abort;

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mpRequest)
        .values({
          siteId: derivedSiteId,
          siteLocationId,
          type: parsed.data.type,
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
      if (row.status !== "submitted") {
        throw new ActionAbort({ ok: false, message: NOT_EDITABLE });
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
          date: mpRequestLine.date,
          headcount: mpRequestLine.headcount,
        })
        .from(mpRequestLine)
        .where(eq(mpRequestLine.requestId, id));

      const references = await checkLineReferences(
        parsed.data,
        row.siteLocationId,
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

export async function advanceStatus(
  id: string,
  nextStatus: "received" | "processing" | "fulfilled" | "rejected",
): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = advanceStatusSchema.safeParse({ id, status: nextStatus });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Same weld-in-WHERE read as updateRequestLines, row locked.
      const [row] = await tx
        .select({
          status: mpRequest.status,
          type: mpRequest.type,
          siteId: mpRequest.siteId,
          siteLocationId: mpRequest.siteLocationId,
        })
        .from(mpRequest)
        .where(mpRequestMutationWhere(actor, parsed.data.id))
        .limit(1)
        .for("update");
      if (!row) throw new ActionAbort({ ok: false, message: NOT_FOUND });

      if (!LEGAL_TRANSITIONS[row.status].includes(parsed.data.status)) {
        throw new ActionAbort({ ok: false, message: ILLEGAL_TRANSITION });
      }

      // Guarded write: the expected-current status rides in the WHERE, so a
      // concurrent move turns this write into a 0-row no-op instead of a
      // double transition.
      const updated = await tx
        .update(mpRequest)
        .set({ status: parsed.data.status })
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
          newValue: parsed.data.status,
        },
      });

      return { ok: true } as ActionState;
    });

    revalidatePath("/dashboard/requests");
    return result;
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return { ok: false, message: GENERIC_ERROR };
  }
}
