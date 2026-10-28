import { and, eq, getTableName, isNotNull, or } from "drizzle-orm";

import {
  attendanceRecord,
  mpRequestLine,
  rosterAssignment,
  shiftDefinition,
} from "../drizzle/schema";
import type { Tx } from "../types/db-tx";
import type { PurgeCoverage, RowResult } from "../types/deleted";

const NOT_FOUND = "Deleted shift not found.";

// Every table the purge deletes from or refuses on. Nothing cascades: a shift
// is a leaf of the master data, so the purge removes only its own row and
// refuses while any row still points at it.
// lib/shift-purge-coverage.test.ts compares these lists with the real foreign
// keys, so a table added later that points at shift_definition cannot be
// forgotten silently (the RESTRICT backstop would only fail the purge with a
// generic message). Names come from the drizzle tables, never from literals.
export const PURGE_COVERAGE: PurgeCoverage = {
  // Deleted by purgeShiftGuarded below.
  purged: [shiftDefinition].map(getTableName),
  // Any row at all refuses the purge.
  history: [rosterAssignment, mpRequestLine, attendanceRecord].map(
    getTableName,
  ),
  cascade: [],
};

// Permanent delete of an already soft-deleted shift (superadmin only, the
// caller enforces it). Guards read first and the delete runs last, all in the
// caller's transaction, so a refusal leaves nothing partial. Roster
// assignments, request lines and attendance records (as the worked or the
// rostered shift) are history and always refuse. FK RESTRICT stays the
// backstop (the action maps it through mapDbError).
//
// Exported for tests, mirroring purgeSiteGuarded.
export async function purgeShiftGuarded(
  tx: Tx,
  id: string,
): Promise<RowResult> {
  const [row] = await tx
    .select({ id: shiftDefinition.id })
    .from(shiftDefinition)
    .where(and(eq(shiftDefinition.id, id), isNotNull(shiftDefinition.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: NOT_FOUND };

  const [assignment] = await tx
    .select({ id: rosterAssignment.id })
    .from(rosterAssignment)
    .where(eq(rosterAssignment.shiftDefinitionId, id))
    .limit(1);
  if (assignment) {
    return {
      ok: false,
      message: "Shift has roster history and cannot be permanently deleted",
    };
  }

  const [line] = await tx
    .select({ id: mpRequestLine.id })
    .from(mpRequestLine)
    .where(eq(mpRequestLine.shiftDefinitionId, id))
    .limit(1);
  if (line) {
    return {
      ok: false,
      message: "Shift has request history and cannot be permanently deleted",
    };
  }

  const [attendance] = await tx
    .select({ id: attendanceRecord.id })
    .from(attendanceRecord)
    .where(
      or(
        eq(attendanceRecord.shiftDefinitionId, id),
        eq(attendanceRecord.rosteredShiftDefinitionId, id),
      ),
    )
    .limit(1);
  if (attendance) {
    return {
      ok: false,
      message: "Shift has attendance history and cannot be permanently deleted",
    };
  }

  await tx.delete(shiftDefinition).where(eq(shiftDefinition.id, id));
  return { ok: true };
}
