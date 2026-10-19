"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { department, siteLocation, user, workArea } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError, pgErrorCode } from "@/lib/db-errors";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { workAreaCreateSchema, workAreaUpdateSchema } from "@/schema/validators";
import {
  workAreaMutationWhere,
  workAreaOwnedByActor,
  workAreaBulkMutationWhere,
} from "@/lib/department-scope";

// Maps a driver error to the action result shape; mapDbError returns null for
// anything unexpected, so fall back to a generic message.
function dbResult(err: unknown): ActionState {
  const mapped = mapDbError(err, { kind: "work-area-name" });
  if (mapped) return { ok: false, message: mapped };
  return { ok: false, message: GENERIC_ERROR };
}

// The composite FKs on work_area (department_id+site_id and
// site_location_id+site_id) both carry ON DELETE restrict, so a cross-site
// pairing surfaces as 23503/23001 on create or update. The pre-checks below
// catch the department-scoping case; this is the net for anything left.
const SAME_SITE_MESSAGE = "Department and location must belong to the same site";

function fkResult(err: unknown, sameSiteMessage: string): ActionState {
  const code = pgErrorCode(err);
  if (code === "23503" || code === "23001") {
    return { ok: false, message: sameSiteMessage };
  }
  return dbResult(err);
}

// Admin actors are pinned to their own site_location — anything the client
// sent is ignored. A superadmin keeps the input value (the composite FK
// validates it against the derived site); an ho has no location binding and
// keeps the input too, but their department scope below fails first.
function effectiveSiteLocationId(
  actor: SessionUser,
  inputSiteLocationId: string | undefined,
): string | undefined {
  return actor.role === "admin"
    ? (actor.siteLocationId ?? undefined)
    : inputSiteLocationId;
}

// siteId is NEVER trusted from the client: it is derived from the
// department's own site, so the composite FK pairing is decided server-side.
async function deriveSiteId(departmentId: string): Promise<string | null> {
  const [row] = await db
    .select({ siteId: department.siteId })
    .from(department)
    .where(and(eq(department.id, departmentId), isNull(department.deletedAt)))
    .limit(1);
  return row ? row.siteId : null;
}

// Scope check for the derived department: an admin may only reference a
// department under their own location's site; an ho only under their own
// site. A foreign department surfaces as a field error, mirroring the
// locations actions' per-field shape for scope violations.
async function departmentInScope(
  actor: SessionUser,
  deptSiteId: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;
  if (actor.role === "ho") return deptSiteId === actor.siteId;

  if (!actor.siteLocationId) return false;
  const [loc] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(eq(siteLocation.id, actor.siteLocationId))
    .limit(1);
  return !!loc && loc.siteId === deptSiteId;
}

const DEPT_SCOPE_FIELD_ERRORS = {
  departmentId: "Department must belong to your site",
} as const;

export async function createWorkArea(input: {
  departmentId: string;
  siteId?: string;
  siteLocationId?: string;
  name: string;
}): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = workAreaCreateSchema.safeParse({
    departmentId: input.departmentId,
    // Ignored — derived from the department below.
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    name: input.name,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // An unbound admin fails closed at the field, not at the DB.
  if (!parsed.data.siteLocationId) {
    return { ok: false, fieldErrors: DEPT_SCOPE_FIELD_ERRORS };
  }

  const derivedSiteId = await deriveSiteId(parsed.data.departmentId);
  if (!derivedSiteId) {
    return { ok: false, fieldErrors: { departmentId: "Department not found." } };
  }
  if (!(await departmentInScope(actor, derivedSiteId))) {
    return { ok: false, fieldErrors: DEPT_SCOPE_FIELD_ERRORS };
  }

  try {
    await db.insert(workArea).values({
      departmentId: parsed.data.departmentId,
      siteId: derivedSiteId,
      siteLocationId: parsed.data.siteLocationId,
      name: parsed.data.name,
    });
  } catch (err) {
    return fkResult(err, SAME_SITE_MESSAGE);
  }

  revalidatePath("/dashboard/work-areas");
  return { ok: true };
}

export async function updateWorkArea(
  id: string,
  input: {
    departmentId: string;
    siteId?: string;
    siteLocationId?: string;
    name: string;
    isActive: boolean;
  },
): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = workAreaUpdateSchema.safeParse({
    id,
    departmentId: input.departmentId,
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    name: input.name,
    isActive: input.isActive,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Ownership before any write: the row must already sit in the actor's
  // scope, or a foreign work area would be rewritten.
  if (!(await workAreaOwnedByActor(actor, parsed.data.id))) {
    return { ok: false, message: "Work area not found." };
  }

  const derivedSiteId = await deriveSiteId(parsed.data.departmentId);
  if (!derivedSiteId) {
    return { ok: false, fieldErrors: { departmentId: "Department not found." } };
  }
  if (!(await departmentInScope(actor, derivedSiteId))) {
    return { ok: false, fieldErrors: DEPT_SCOPE_FIELD_ERRORS };
  }

  try {
    const updated = await db
      .update(workArea)
      .set({
        departmentId: parsed.data.departmentId,
        siteId: derivedSiteId,
        // undefined for an ho/superadmin edit without a siteLocationId (keep
        // the current location); an admin always lands on their own.
        siteLocationId: parsed.data.siteLocationId,
        name: parsed.data.name,
        isActive: parsed.data.isActive,
      })
      // Weld: the ownership predicate rides inside the mutating WHERE.
      .where(workAreaMutationWhere(actor, parsed.data.id))
      .returning({ id: workArea.id });
    if (updated.length === 0) {
      return { ok: false, message: "Work area not found." };
    }
  } catch (err) {
    return fkResult(err, SAME_SITE_MESSAGE);
  }

  revalidatePath("/dashboard/work-areas");
  return { ok: true };
}

export async function toggleWorkArea(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid work area id." };
  }

  try {
    const toggled = await db
      .update(workArea)
      .set({ isActive: sql`not ${workArea.isActive}` })
      .where(workAreaMutationWhere(actor, id))
      .returning({ isActive: workArea.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Work area not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/work-areas");
  return { ok: true };
}

export async function deleteWorkArea(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid work area id." };
  }

  // Foreign work areas answer "not found." — never "users are still bound",
  // which would leak that the row exists.
  if (!(await workAreaOwnedByActor(actor, id))) {
    return { ok: false, message: "Work area not found." };
  }

  // Only LIVE users count — an already soft-deleted user must not
  // resurrect its own binding. The hide on user.workAreaId stays restrict,
  // caught by the driver-side FK as a backstop.
  const bound = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.workAreaId, id), isNull(user.deletedAt)))
    .limit(1);
  if (bound.length > 0) {
    return { ok: false, message: "Users are still bound to this work area" };
  }

  try {
    await db
      .update(workArea)
      .set({ deletedAt: new Date() })
      // Weld: same ownership-in-WHERE as update/toggle.
      .where(workAreaMutationWhere(actor, id));
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/work-areas");
  return { ok: true };
}

// Bulk subset-write of workArea.isActive. "Do what you can": malformed ids
// are dropped and the ownership weld rides inside the mutating WHERE, so an
// admin (or ho) can never widen its batch past its own scope no matter what
// ids arrive.
export async function setActiveBulk(
  ids: string[],
  isActive: boolean,
): Promise<ActionState> {
  const actor = await requireUser();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No work areas selected." };
  }

  try {
    const updated = await db
      .update(workArea)
      .set({ isActive })
      .where(workAreaBulkMutationWhere(actor, validIds))
      .returning({ id: workArea.id });
    revalidatePath("/dashboard/work-areas");
    return { ok: true, applied: updated.length };
  } catch (err) {
    return dbResult(err);
  }
}

// Bulk work-area unregistration. Rows with LIVE users still bound are
// skipped (not fatal) with the same guard message the single-row path
// gives: the bound check rides the same ownership WHERE, so foreign work
// areas can never leak into either count. The write soft-deletes.
export async function deleteBulk(ids: string[]): Promise<ActionState> {
  const actor = await requireUser();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No work areas selected." };
  }

  // User-bound rows among the requested set, scoped by the same weld —
  // this select maps 1:1 onto "these rows will refuse to delete."
  const boundRows = await db
    .select({ id: user.workAreaId })
    .from(user)
    .innerJoin(workArea, eq(user.workAreaId, workArea.id))
    .where(
      and(workAreaBulkMutationWhere(actor, validIds), isNull(user.deletedAt)),
    );

  const boundIds = new Set(
    boundRows
      .filter((row): row is { id: string } => row.id !== null)
      .map((row) => row.id),
  );

  try {
    const deleted = await db
      .update(workArea)
      .set({ deletedAt: new Date() })
      .where(
        workAreaBulkMutationWhere(
          actor,
          validIds.filter((id) => !boundIds.has(id)),
        ),
      );
    const result: ActionState = {
      ok: true,
      applied: deleted.rowCount ?? 0,
      blocked: boundIds.size,
    };
    if (boundIds.size > 0) {
      result.message = `${boundIds.size} work area${boundIds.size === 1 ? "" : "s"} skipped: Users are still bound to this work area`;
    }
    revalidatePath("/dashboard/work-areas");
    return result;
  } catch (err) {
    return dbResult(err);
  }
}
