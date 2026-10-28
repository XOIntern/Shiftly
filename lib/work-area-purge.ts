import { and, eq, getTableName, isNotNull } from "drizzle-orm";

import {
  attendanceRecord,
  mpRequestLine,
  rosterAssignment,
  workArea,
  workAreaPosition,
} from "../drizzle/schema";
import type { Tx } from "../types/db-tx";
import type { PurgeCoverage, RowResult } from "../types/deleted";

const NOT_FOUND = "Deleted work area not found.";

// Every table the purge deletes from or refuses on. Nothing cascades.
// lib/work-area-purge-coverage.test.ts compares these lists with the real
// foreign keys, so a table added later that points at work_area cannot be
// forgotten silently (the RESTRICT backstop would only fail the purge with a
// generic message). Names come from the drizzle tables, never from literals.
export const PURGE_COVERAGE: PurgeCoverage = {
  // Deleted by purgeWorkAreaGuarded below.
  purged: [workAreaPosition, workArea].map(getTableName),
  // Any row at all refuses the purge.
  history: [rosterAssignment, mpRequestLine, attendanceRecord].map(
    getTableName,
  ),
  cascade: [],
};

// Permanent delete of an already soft-deleted work area (superadmin only, the
// caller enforces it). Guards read first and the deletes run last, all in the
// caller's transaction, so a refusal leaves nothing partial. Roster
// assignments, request lines and attendance records are history and always
// refuse. The area's own
// position links are removed with it, first because their FK is ON DELETE
// RESTRICT; the positions themselves belong to the site and stay. FK RESTRICT
// stays the backstop (the action maps it through mapDbError).
//
// Exported for tests, mirroring purgeSiteGuarded.
export async function purgeWorkAreaGuarded(
  tx: Tx,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ id: workArea.id })
    .from(workArea)
    .where(and(eq(workArea.id, id), isNotNull(workArea.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  const [assignment] = await tx
    .select({ id: rosterAssignment.id })
    .from(rosterAssignment)
    .where(eq(rosterAssignment.workAreaId, id))
    .limit(1);
  if (assignment) {
    return {
      ok: false,
      message: "Work area has roster history and cannot be permanently deleted",
    };
  }

  const [line] = await tx
    .select({ id: mpRequestLine.id })
    .from(mpRequestLine)
    .where(eq(mpRequestLine.workAreaId, id))
    .limit(1);
  if (line) {
    return {
      ok: false,
      message: "Work area has request history and cannot be permanently deleted",
    };
  }

  const [attendance] = await tx
    .select({ id: attendanceRecord.id })
    .from(attendanceRecord)
    .where(eq(attendanceRecord.workAreaId, id))
    .limit(1);
  if (attendance) {
    return {
      ok: false,
      message:
        "Work area has attendance history and cannot be permanently deleted",
    };
  }

  await tx.delete(workAreaPosition).where(eq(workAreaPosition.workAreaId, id));
  await tx.delete(workArea).where(eq(workArea.id, id));
  return { ok: true };
}
