"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { department, user, workArea } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError } from "@/lib/db-errors";
import { requireHO, type SessionUser } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import {
  departmentCreateSchema,
  departmentUpdateSchema,
} from "@/lib/validators";
import {
  departmentMutationWhere,
  departmentOwnedByActor,
  departmentBulkMutationWhere,
} from "@/lib/department-scope";

// Maps a driver error to the action result shape; mapDbError returns null for
// anything unexpected, so fall back to a generic message.
function dbResult(err: unknown): ActionState {
  const mapped = mapDbError(err, { kind: "department-name" });
  if (mapped) return { ok: false, message: mapped };
  return { ok: false, message: GENERIC_ERROR };
}

// HO scoping (issue #13): a ho's effective siteId is their own binding —
// anything the client sent is ignored. A superadmin keeps the input value;
// an invalid one is caught by the site_id FK.
function effectiveSiteId(
  actor: SessionUser,
  inputSiteId: string | undefined,
): string | undefined {
  return actor.role === "superadmin"
    ? inputSiteId
    : (actor.siteId ?? undefined);
}

export async function createDepartment(input: {
  siteId?: string;
  name: string;
}): Promise<ActionState> {
  const actor = await requireHO();

  const parsed = departmentCreateSchema.safeParse({
    siteId: effectiveSiteId(actor, input.siteId),
    name: input.name,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Unreachable from the dialogs (their site select forces a pick), but a
  // direct caller without a siteId surfaces a per-field error instead of a
  // DB not-null failure. A ho without a site binding lands here too.
  if (!parsed.data.siteId) {
    return { ok: false, fieldErrors: { siteId: "Site is required." } };
  }

  try {
    await db.insert(department).values({
      siteId: parsed.data.siteId,
      name: parsed.data.name,
    });
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/departments");
  return { ok: true };
}

export async function updateDepartment(
  id: string,
  input: { name: string; siteId?: string; isActive: boolean },
): Promise<ActionState> {
  const actor = await requireHO();

  const parsed = departmentUpdateSchema.safeParse({
    id,
    siteId: effectiveSiteId(actor, input.siteId),
    name: input.name,
    isActive: input.isActive,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  // Ownership before any write: for an ho the row must already sit in their
  // site, or a foreign department would be re-parented in. This must run
  // before the update whose set() pins siteId to the actor's site.
  if (!(await departmentOwnedByActor(actor, parsed.data.id))) {
    return { ok: false, message: "Department not found." };
  }

  try {
    const updated = await db
      .update(department)
      .set({
        name: parsed.data.name,
        // undefined for a superadmin edit without a siteId (keep the
        // current site); a ho always lands on their own site.
        siteId: parsed.data.siteId,
        isActive: parsed.data.isActive,
      })
      // Weld (issue #17 Task 2): the ownership predicate rides inside the
      // mutating WHERE, so the check above is redundancy, not the last
      // line of defense.
      .where(departmentMutationWhere(actor, parsed.data.id))
      .returning({ id: department.id });
    if (updated.length === 0) {
      return { ok: false, message: "Department not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/departments");
  return { ok: true };
}

export async function toggleDepartment(id: string): Promise<ActionState> {
  const actor = await requireHO();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid department id." };
  }

  if (!(await departmentOwnedByActor(actor, id))) {
    return { ok: false, message: "Department not found." };
  }

  try {
    const toggled = await db
      .update(department)
      .set({ isActive: sql`not ${department.isActive}` })
      .where(departmentMutationWhere(actor, id))
      .returning({ isActive: department.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Department not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/departments");
  return { ok: true };
}

export async function deleteDepartment(id: string): Promise<ActionState> {
  const actor = await requireHO();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid department id." };
  }

  // Foreign departments answer "not found." — never "users are still
  // bound", which would leak that the row exists.
  if (!(await departmentOwnedByActor(actor, id))) {
    return { ok: false, message: "Department not found." };
  }

  // Rows the delete may not touch: users bound via user.departmentId AND
  // work areas still hanging off the department (a live work_area row
  // would lose its option entry and fail its edits) — anything else is
  // caught by the driver-side FK as a backstop. Only LIVE rows count — an
  // already soft-deleted user or work area must not resurrect its own
  // binding.
  const bound = await db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.departmentId, id), isNull(user.deletedAt)))
    .limit(1);
  if (bound.length > 0) {
    return { ok: false, message: "Users are still bound to this department" };
  }
  const [boundWa] = await db
    .select({ id: workArea.id })
    .from(workArea)
    .where(and(eq(workArea.departmentId, id), isNull(workArea.deletedAt)))
    .limit(1);
  if (boundWa) {
    return { ok: false, message: "Work areas still exist under this department" };
  }

  try {
    await db
      .update(department)
      .set({ deletedAt: new Date() })
      // Weld (issue #17 Task 2): same ownership-in-WHERE as update/toggle,
      // with the bound-users pre-check above intact for its message.
      .where(departmentMutationWhere(actor, id));
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/departments");
  return { ok: true };
}

// Bulk subset-write of department.isActive. "Do what you can": malformed ids
// are dropped and the ownership weld rides inside the mutating WHERE, so an
// ho can never widen its batch past its own site no matter what ids arrive.
export async function setActiveBulk(
  ids: string[],
  isActive: boolean,
): Promise<ActionState> {
  const actor = await requireHO();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No departments selected." };
  }

  try {
    const updated = await db
      .update(department)
      .set({ isActive })
      .where(departmentBulkMutationWhere(actor, validIds))
      .returning({ id: department.id });
    revalidatePath("/dashboard/departments");
    return { ok: true, applied: updated.length };
  } catch (err) {
    return dbResult(err);
  }
}

// Bulk department unregistration. Rows with LIVE users still bound are
// skipped (not fatal) with the same guard message the single-row path
// gives, as are rows that still hold live work areas under them: the
// bound checks ride the same ownership WHERE, so foreign departments can
// never leak into either count. The write soft-deletes — deleted_at is
// set, the row itself stays.
export async function deleteBulk(ids: string[]): Promise<ActionState> {
  const actor = await requireHO();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No departments selected." };
  }

  // User-bound rows among the requested set, scoped by the same weld —
  // this select maps 1:1 onto "these rows will refuse to delete."
  const userBoundRows = await db
    .select({ id: user.departmentId })
    .from(user)
    .innerJoin(department, eq(user.departmentId, department.id))
    .where(
      and(departmentBulkMutationWhere(actor, validIds), isNull(user.deletedAt)),
    );

  const userBoundIds = new Set(
    userBoundRows
      .filter((row): row is { id: string } => row.id !== null)
      .map((row) => row.id),
  );

  // Same weld for the work-area subtree guard: a department that still
  // holds live work areas refuses to delete, same "skip what you can"
  // semantics as the bound users above.
  const workAreaBoundRows = await db
    .select({ id: workArea.departmentId })
    .from(workArea)
    .innerJoin(department, eq(workArea.departmentId, department.id))
    .where(
      and(
        departmentBulkMutationWhere(actor, validIds),
        isNull(workArea.deletedAt),
      ),
    );

  const workAreaOnlyIds = new Set(
    workAreaBoundRows
      .map((row) => row.id)
      .filter((id) => id !== null && !userBoundIds.has(id)),
  );

  const blockedIds = new Set([...userBoundIds, ...workAreaOnlyIds]);

  try {
    const deleted = await db
      .update(department)
      .set({ deletedAt: new Date() })
      .where(
        departmentBulkMutationWhere(
          actor,
          validIds.filter((id) => !blockedIds.has(id)),
        ),
      );
    const result: ActionState = {
      ok: true,
      applied: deleted.rowCount ?? 0,
      blocked: blockedIds.size,
    };
    if (blockedIds.size > 0) {
      // Same message the single-row path gives per blocking reason; a
      // department bound by both reads once under the users reason.
      const reasons: string[] = [];
      if (userBoundIds.size > 0) {
        reasons.push("Users are still bound to this department");
      }
      if (workAreaOnlyIds.size > 0) {
        reasons.push("Work areas still exist under this department");
      }
      result.message = `${blockedIds.size} department${blockedIds.size === 1 ? "" : "s"} skipped: ${reasons.join("; ")}`;
    }
    revalidatePath("/dashboard/departments");
    return result;
  } catch (err) {
    return dbResult(err);
  }
}
