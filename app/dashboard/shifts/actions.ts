"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { siteLocation, shiftDefinition } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { pgErrorCode } from "@/error/db-errors";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import {
  shiftCreateSchema,
  shiftUpdateSchema,
  type ShiftCreateInput,
  type ShiftUpdateInput,
} from "@/validation/validators";
import { shiftMutationWhere, shiftOwnedByActor } from "@/lib/shift-scope";

// The partial unique on shift_definition (site_location_id, order_index)
// WHERE deleted_at IS NULL surfaces as 23505 both on create and on order
// moves — a per-field error so the form can point at the offending slot.
const ORDER_TAKEN = "Order is already used by another shift";

// The composite FK on shift_definition (site_location_id + site_id) carries
// ON DELETE restrict, so a pairing whose location row vanished between the
// site derivation and the write surfaces as 23503/23001. The site is
// always derived server-side from the location, so any other firing is a
// race — this is the net.
const FK_MESSAGE = "Selected location no longer exists";

// Maps a driver error to the action result shape. The order-slot duplicate
// is a field error (23505 predates any other constraint in play), other
// known driver failures map to plain messages, and anything unexpected
// falls back to the generic error.
function shiftResult(err: unknown): ActionState {
  const code = pgErrorCode(err);
  if (code === "23505") {
    return { ok: false, fieldErrors: { orderIndex: ORDER_TAKEN } };
  }
  if (code === "23503" || code === "23001") {
    return { ok: false, message: FK_MESSAGE };
  }
  return { ok: false, message: GENERIC_ERROR };
}

// Admin actors are pinned to their own site_location — anything the client
// sent is ignored. A superadmin keeps the input value; an ho has no
// location binding and keeps the input too, but their site scope below
// verifies it.
function effectiveSiteLocationId(
  actor: SessionUser,
  inputSiteLocationId: string | undefined,
): string | undefined {
  return actor.role === "admin"
    ? (actor.siteLocationId ?? undefined)
    : inputSiteLocationId;
}

// siteId is NEVER trusted from the client: it is derived from the shift's
// own site_location, so the composite FK pairing is decided server-side. A
// soft-deleted location cannot parent a shift (mirrors the work-area
// derivation's live-row weld).
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

// Scope check for the chosen location: an ho may only reference a location
// under their own site. A foreign location surfaces as a field error,
// mirroring the work-areas actions' per-field shape for scope violations.
// An admin's pick is pinned to their own binding before this runs;
// superadmin is unscoped.
const LOCATION_SCOPE_FIELD_ERRORS = {
  siteLocationId: "Location must be in your site",
} as const;

function locationInScope(actor: SessionUser, locationSiteId: string | null) {
  return actor.role !== "ho" || locationSiteId === actor.siteId;
}

async function resolveLocation(
  actor: SessionUser,
  siteLocationId: string,
): Promise<{ ok: true; siteId: string } | { ok: false; result: ActionState }> {
  const derivedSiteId = await deriveSiteId(siteLocationId);
  if (!derivedSiteId) {
    return {
      ok: false,
      result: {
        ok: false,
        fieldErrors: { siteLocationId: "Location not found." },
      },
    };
  }
  if (!locationInScope(actor, derivedSiteId)) {
    return { ok: false, result: { ok: false, fieldErrors: LOCATION_SCOPE_FIELD_ERRORS } };
  }
  return { ok: true, siteId: derivedSiteId };
}

export async function createShift(
  input: ShiftCreateInput,
): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = shiftCreateSchema.safeParse({
    // Ignored — derived from the site_location below.
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    label: input.label,
    orderIndex: input.orderIndex,
    startTime: input.startTime,
    endTime: input.endTime,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // An unbound admin fails closed at the field, not at the DB (the
  // required siteLocationId rejects the undefined effective value).
  const resolved = await resolveLocation(actor, parsed.data.siteLocationId);
  if (!resolved.ok) return resolved.result;

  try {
    await db.insert(shiftDefinition).values({
      siteId: resolved.siteId,
      siteLocationId: parsed.data.siteLocationId,
      label: parsed.data.label,
      orderIndex: parsed.data.orderIndex,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    });
  } catch (err) {
    return shiftResult(err);
  }

  revalidatePath("/dashboard/shifts");
  return { ok: true };
}

export async function updateShift(
  id: string,
  input: ShiftUpdateInput,
): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = shiftUpdateSchema.safeParse({
    id,
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    label: input.label,
    orderIndex: input.orderIndex,
    startTime: input.startTime,
    endTime: input.endTime,
    isActive: input.isActive,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Ownership before any write: the row must already sit in the actor's
  // scope, or a foreign shift would be rewritten.
  if (!(await shiftOwnedByActor(actor, parsed.data.id))) {
    return { ok: false, message: "Shift not found." };
  }

  const resolved = await resolveLocation(actor, parsed.data.siteLocationId);
  if (!resolved.ok) return resolved.result;

  try {
    const updated = await db
      .update(shiftDefinition)
      .set({
        siteId: resolved.siteId,
        siteLocationId: parsed.data.siteLocationId,
        label: parsed.data.label,
        orderIndex: parsed.data.orderIndex,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        isActive: parsed.data.isActive,
      })
      // Weld: the ownership predicate rides inside the mutating WHERE.
      .where(shiftMutationWhere(actor, parsed.data.id))
      .returning({ id: shiftDefinition.id });
    if (updated.length === 0) {
      return { ok: false, message: "Shift not found." };
    }
  } catch (err) {
    return shiftResult(err);
  }

  revalidatePath("/dashboard/shifts");
  return { ok: true };
}

// Soft-delete only (mp-requests Task 3): the partial unique exempts
// deleted_at rows, so the order_index slot is freed immediately. The
// mp_request_line referenced-by guard is Task 5's step: mp_request_line
// does not exist yet, and importing it here would fail to compile until
// Task 5's schema lands. Task 5 must wrap this delete with the live
// mp_request_line count check and return
// "Shift is still referenced by a request" while one references it.
export async function deleteShift(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid shift id." };
  }

  // Foreign shifts answer "not found." — never anything scope-leaking.
  if (!(await shiftOwnedByActor(actor, id))) {
    return { ok: false, message: "Shift not found." };
  }

  try {
    await db
      .update(shiftDefinition)
      .set({ deletedAt: new Date() })
      // Weld: same ownership-in-WHERE as update.
      .where(shiftMutationWhere(actor, id));
  } catch (err) {
    return shiftResult(err);
  }

  revalidatePath("/dashboard/shifts");
  return { ok: true };
}
