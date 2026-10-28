"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  position,
  siteLocation,
  worker,
  workerPosition,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { mapDbError, pgErrorCode } from "@/error/db-errors";
import { requireSuperadmin, requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import {
  workerCreateSchema,
  workerUpdateSchema,
} from "@/validation/worker";
import {
  workerBulkMutationWhere,
  workerMutationWhere,
  workerOwnedByActor,
} from "@/lib/worker-scope";
import { purgeWorkerGuarded } from "@/lib/worker-purge";
import { restoreWorkerGuarded } from "@/lib/worker-restore";
import { nounFor } from "@/lib/bulk-summary";
import { runPerRow } from "@/lib/run-per-row";

// Thrown inside updateWorker's transaction so the pivot delete that ran
// before the welded update is rolled back, not committed. A returned value
// would commit the transaction; a throw is the only rollback.
class WorkerNotFoundError extends Error {}

// Maps a driver error to the action result shape; mapDbError returns null for
// anything unexpected, so fall back to a generic message.
function dbResult(err: unknown): ActionState {
  const mapped = mapDbError(err, { kind: "worker-employee-id" });
  if (mapped) return { ok: false, message: mapped };
  return { ok: false, message: GENERIC_ERROR };
}

// The composite FKs on worker (site_location+site, position+site) carry ON
// DELETE restrict, so a pairing whose parent row vanished between the pick
// and the write surfaces as 23503/23001. Any other firing is a race — this
// is the net.
const FK_MESSAGE = "Selected location or position no longer exists";

function fkResult(err: unknown): ActionState {
  const code = pgErrorCode(err);
  if (code === "23503" || code === "23001") {
    return { ok: false, message: FK_MESSAGE };
  }
  return dbResult(err);
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

// siteId is NEVER trusted from the client: it is derived from the worker's
// own site_location, so the composite FK pairing is decided server-side.
// A soft-deleted location cannot parent a worker (live-row weld).
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

// Every position of the set must be live and parent to the SAME site as
// the derived location, or no worker write happens. Inactive positions are
// tolerated: an edit that never touches the set must not fail because one
// was deactivated since the picker snapshot.
type PositionsCheck =
  | { ok: true }
  | { fieldError: "Position must be in the same site as the location" };

async function loadAndCheckPositions(
  ids: string[],
  siteId: string,
): Promise<PositionsCheck> {
  const rows = await db
    .select({ id: position.id, siteId: position.siteId })
    .from(position)
    .where(and(inArray(position.id, ids), isNull(position.deletedAt)));
  const allLiveAndSameSite =
    rows.length === ids.length && rows.every((row) => row.siteId === siteId);
  return allLiveAndSameSite
    ? { ok: true }
    : { fieldError: "Position must be in the same site as the location" };
}

// Scope check for the chosen location: an ho may only reference a location
// under their own site. A foreign location surfaces as a field error,
// mirroring the work-area actions' per-field shape for scope violations. An
// admin's pick is pinned to their own binding before this runs;
// superadmin is unscoped.
const LOCATION_SCOPE_FIELD_ERRORS = {
  siteLocationId: "Location must be in your site",
} as const;

function locationInScope(actor: SessionUser, locationSiteId: string | null) {
  return actor.role !== "ho" || locationSiteId === actor.siteId;
}

// Shared create/update checks on the NEW location: derive its site, then
// fail closed at the field. An admin's binding is the only location they
// can ever land on, so a binding that no longer resolves to a live row
// answers "not found" (a move is impossible; the override re-pins). Any
// other missing/dead pick — there is no required field left to ask for —
// surfaces as "Location is required".
async function deriveLocationSiteId(
  actor: SessionUser,
  siteLocationId: string,
): Promise<string | { fieldErrors: Record<string, string> }> {
  const derivedSiteId = await deriveSiteId(siteLocationId);
  if (derivedSiteId) return derivedSiteId;
  if (actor.role === "admin") {
    return { fieldErrors: { siteLocationId: "Location not found." } };
  }
  return { fieldErrors: { siteLocationId: "Location is required" } };
}

export async function createWorker(input: {
  siteLocationId?: string;
  positionIds: string[];
  employeeId: string;
  name: string;
  contractEndDate?: string;
}): Promise<ActionState> {
  const actor = await requireUser();

  const parsed = workerCreateSchema.safeParse({
    // Ignored — derived from the site_location below.
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    positionIds: input.positionIds,
    employeeId: input.employeeId,
    name: input.name,
    contractEndDate: input.contractEndDate,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const derivedSiteId = await deriveLocationSiteId(
    actor,
    parsed.data.siteLocationId,
  );
  if (typeof derivedSiteId !== "string") {
    return { ok: false, fieldErrors: derivedSiteId.fieldErrors };
  }
  if (!locationInScope(actor, derivedSiteId)) {
    return { ok: false, fieldErrors: LOCATION_SCOPE_FIELD_ERRORS };
  }
  const positionCheck = await loadAndCheckPositions(
    parsed.data.positionIds,
    derivedSiteId,
  );
  if ("fieldError" in positionCheck) {
    return {
      ok: false,
      fieldErrors: { positionIds: positionCheck.fieldError },
    };
  }

  try {
    // The worker and its whole qualification set commit or roll back
    // together: a worker never lands without at least one position.
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(worker)
        .values({
          siteLocationId: parsed.data.siteLocationId,
          siteId: derivedSiteId,
          employeeId: parsed.data.employeeId,
          name: parsed.data.name,
          contractEndDate: parsed.data.contractEndDate ?? null,
        })
        .returning({ id: worker.id });
      await tx.insert(workerPosition).values(
        parsed.data.positionIds.map((positionId) => ({
          workerId: row.id,
          positionId,
          siteId: derivedSiteId,
        })),
      );
    });
  } catch (err) {
    return fkResult(err);
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function updateWorker(
  id: string,
  input: {
    siteLocationId?: string;
    positionIds: string[];
    employeeId: string;
    name: string;
    contractEndDate?: string;
    isActive: boolean;
  },
): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid worker id." };
  }

  // Ownership before any write: the row must already sit in the actor's
  // scope, or a foreign worker would be rewritten. A worker is the one
  // master-data row that MOVES — so the new location is derived, scoped
  // and paired with the position after this gate, never before.
  if (!(await workerOwnedByActor(actor, id))) {
    return { ok: false, message: "Worker not found." };
  }

  const parsed = workerUpdateSchema.safeParse({
    id,
    // Ignored — derived from the site_location below.
    siteId: undefined,
    siteLocationId: effectiveSiteLocationId(actor, input.siteLocationId),
    positionIds: input.positionIds,
    employeeId: input.employeeId,
    name: input.name,
    contractEndDate: input.contractEndDate,
    isActive: input.isActive,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const derivedSiteId = await deriveLocationSiteId(
    actor,
    parsed.data.siteLocationId,
  );
  if (typeof derivedSiteId !== "string") {
    return { ok: false, fieldErrors: derivedSiteId.fieldErrors };
  }
  if (!locationInScope(actor, derivedSiteId)) {
    return { ok: false, fieldErrors: LOCATION_SCOPE_FIELD_ERRORS };
  }
  const positionCheck = await loadAndCheckPositions(
    parsed.data.positionIds,
    derivedSiteId,
  );
  if ("fieldError" in positionCheck) {
    return {
      ok: false,
      fieldErrors: { positionIds: positionCheck.fieldError },
    };
  }

  try {
    await db.transaction(async (tx) => {
      // Fixed order: the composite FK forbids moving worker.site_id while
      // stale pivot rows still carry the old site. Zero rows from the
      // welded update must ROLL BACK, not return: a returned value commits,
      // which would persist the delete above and leave the worker with an
      // empty set. The throw is the rollback.
      await tx.delete(workerPosition).where(eq(workerPosition.workerId, id));

      const updated = await tx
        .update(worker)
        .set({
          siteLocationId: parsed.data.siteLocationId,
          siteId: derivedSiteId,
          employeeId: parsed.data.employeeId,
          name: parsed.data.name,
          contractEndDate: parsed.data.contractEndDate ?? null,
          isActive: parsed.data.isActive,
        })
        // Weld: the ownership predicate rides inside the mutating WHERE.
        .where(workerMutationWhere(actor, id))
        .returning({ id: worker.id });
      if (updated.length === 0) throw new WorkerNotFoundError();

      await tx.insert(workerPosition).values(
        parsed.data.positionIds.map((positionId) => ({
          workerId: id,
          positionId,
          siteId: derivedSiteId,
        })),
      );
    });
  } catch (err) {
    if (err instanceof WorkerNotFoundError) {
      return { ok: false, message: "Worker not found." };
    }
    return fkResult(err);
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function toggleWorker(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid worker id." };
  }

  try {
    const toggled = await db
      .update(worker)
      .set({ isActive: sql`not ${worker.isActive}` })
      .where(workerMutationWhere(actor, id))
      .returning({ isActive: worker.isActive });
    if (toggled.length === 0) {
      return { ok: false, message: "Worker not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function deleteWorker(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid worker id." };
  }

  // Foreign workers answer "not found." — no scope leaks. Soft delete only
  // flips worker.deleted_at; its worker_position rows stay in place (the
  // position guards join live workers, so stale rows never block a delete).
  if (!(await workerOwnedByActor(actor, id))) {
    return { ok: false, message: "Worker not found." };
  }

  try {
    const deleted = await db
      .update(worker)
      .set({ deletedAt: new Date() })
      // Weld: same ownership-in-WHERE as update/toggle.
      .where(workerMutationWhere(actor, id))
      .returning({ id: worker.id });
    if (deleted.length === 0) {
      return { ok: false, message: "Worker not found." };
    }
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

// Bulk subset-write of worker.isActive. "Do what you can": malformed ids
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
    return { ok: false, message: "No workers selected." };
  }

  try {
    const updated = await db
      .update(worker)
      .set({ isActive })
      .where(workerBulkMutationWhere(actor, validIds))
      .returning({ id: worker.id });
    revalidatePath("/dashboard/workers");
    return { ok: true, applied: updated.length };
  } catch (err) {
    return dbResult(err);
  }
}

// Bulk worker unregistration. Rows are soft-deleted (pivot rows stay in
// place, exactly like deleteWorker), so blocked is always 0 — the shape
// stays identical to the other bulk actions for the toolbar.
export async function deleteBulk(ids: string[]): Promise<ActionState> {
  const actor = await requireUser();

  const validIds = [...new Set(ids)].filter(
    (id) => z.uuid().safeParse(id).success,
  );
  if (validIds.length === 0) {
    return { ok: false, message: "No workers selected." };
  }

  try {
    const deleted = await db
      .update(worker)
      .set({ deletedAt: new Date() })
      .where(workerBulkMutationWhere(actor, validIds));
    const result: ActionState = {
      ok: true,
      applied: deleted.rowCount ?? 0,
      blocked: 0,
    };
    revalidatePath("/dashboard/workers");
    return result;
  } catch (err) {
    return dbResult(err);
  }
}

// Brings a soft-deleted worker back (lib/worker-restore.ts), inside the
// actor's scope: an HO only reaches their own site's rows, an admin their own
// location's, and anything else answers the plain not-found message. Only the
// worker row returns; a deleted location, a deleted held position or an
// employee id now used by a live worker refuses, the id through the guard or
// through the unique-index backstop.
export async function restoreWorker(id: string): Promise<ActionState> {
  const actor = await requireUser();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid worker id." };
  }

  let result: Awaited<ReturnType<typeof restoreWorkerGuarded>>;
  try {
    result = await db.transaction((tx) => restoreWorkerGuarded(tx, actor, id));
  } catch (err) {
    return dbResult(err);
  }

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

// Permanent delete of a soft-deleted worker (superadmin only). Guards and
// writes share one transaction (lib/worker-purge.ts); a roster assignment
// refuses, and the FK backstop is mapped by dbResult.
export async function purgeWorker(id: string): Promise<ActionState> {
  await requireSuperadmin();

  if (!z.uuid().safeParse(id).success) {
    return { ok: false, message: "Invalid worker id." };
  }

  let result: Awaited<ReturnType<typeof purgeWorkerGuarded>>;
  try {
    result = await db.transaction((tx) => purgeWorkerGuarded(tx, id));
  } catch (err) {
    return dbResult(err);
  }

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

const perWorker = {
  emptyMessage: "No workers selected.",
  noun: nounFor("worker"),
  mapError: (err: unknown) => dbResult(err).message ?? GENERIC_ERROR,
};

// Bulk restore of soft-deleted workers, inside the actor's scope: rows of
// another site or location are skipped like any other refusal.
export async function restoreBulk(ids: string[]): Promise<ActionState> {
  const actor = await requireUser();
  const result = await runPerRow(
    ids,
    (tx, id) => restoreWorkerGuarded(tx, actor, id),
    perWorker,
  );
  if (result.ok) revalidatePath("/dashboard/workers");
  return result;
}

// Bulk permanent delete of soft-deleted workers (superadmin only). Each
// worker runs the same guarded purge as purgeWorker; one with roster history
// is skipped.
export async function purgeBulk(ids: string[]): Promise<ActionState> {
  await requireSuperadmin();
  const result = await runPerRow(ids, purgeWorkerGuarded, perWorker);
  if (result.ok) revalidatePath("/dashboard/workers");
  return result;
}
