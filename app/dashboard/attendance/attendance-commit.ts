import { GENERIC_ERROR } from "@/lib/action-state";
import { shouldRefreshAfter } from "@/lib/refresh-after";
import type { ActionState } from "@/types/action-state";
import type { AttendanceStatus, DayRow } from "@/types/attendance";

import {
  addUnscheduled,
  bulkRecord,
  correctAttendance,
  recordAttendance,
  removeUnscheduled,
} from "./actions";

// The write wiring of the day page, kept out of the components so it can be
// tested without a DOM: every commit takes the server action as its last
// argument (the real one by default), so a test passes a recording stub and no
// process-wide module mock leaks into other suites (the commitPick pattern of
// the roster grid). The components call these inside a transition, toast the
// outcome, and refresh the route when `refresh` says the view on screen is
// stale.

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  leave: "Leave",
  sick: "Sick",
  absent: "Absent",
};

export const STATUS_ORDER: AttendanceStatus[] = [
  "present",
  "leave",
  "sick",
  "absent",
];

export type Outcome = { ok: boolean; message: string; refresh: boolean };

type RecordInput = Parameters<typeof recordAttendance>[0];
type BulkInput = Parameters<typeof bulkRecord>[0];
type CorrectInput = Parameters<typeof correctAttendance>[0];
type AddUnscheduledInput = Parameters<typeof addUnscheduled>[0];
type RemoveUnscheduledInput = Parameters<typeof removeUnscheduled>[0];

// A returned failure usually means the record changed in another tab, so the
// caller refreshes after ANY of them; a thrown error is a network or server
// failure, not a stale view, and does not refresh (lib/refresh-after).
async function settle(
  run: () => Promise<ActionState>,
  done: (result: ActionState) => string,
): Promise<Outcome> {
  let result: ActionState;
  try {
    result = await run();
  } catch {
    return { ok: false, message: GENERIC_ERROR, refresh: false };
  }
  if (!result.ok) {
    return {
      ok: false,
      message: result.message ?? GENERIC_ERROR,
      refresh: shouldRefreshAfter(result),
    };
  }
  return { ok: true, message: done(result), refresh: false };
}

export function commitRecord(
  input: RecordInput,
  label: string,
  act: (input: RecordInput) => Promise<ActionState> = recordAttendance,
): Promise<Outcome> {
  return settle(
    () => act(input),
    () => `${label} marked ${input.status}.`,
  );
}

export function commitBulk(
  input: BulkInput,
  act: (input: BulkInput) => Promise<ActionState> = bulkRecord,
): Promise<Outcome> {
  return settle(
    () => act(input),
    (result) => {
      const applied = result.applied ?? 0;
      const blocked = result.blocked ?? 0;
      if (applied === 0) {
        return blocked > 0
          ? `Nothing marked, ${blocked} skipped.`
          : "Nothing marked.";
      }
      return blocked > 0
        ? `${applied} marked ${input.status}, ${blocked} skipped.`
        : `${applied} marked ${input.status}.`;
    },
  );
}

export function commitCorrect(
  input: CorrectInput,
  label: string,
  act: (input: CorrectInput) => Promise<ActionState> = correctAttendance,
): Promise<Outcome> {
  return settle(
    () => act(input),
    () => `${label} corrected.`,
  );
}

export function commitAddUnscheduled(
  input: AddUnscheduledInput,
  label: string,
  act: (input: AddUnscheduledInput) => Promise<ActionState> = addUnscheduled,
): Promise<Outcome> {
  return settle(
    () => act(input),
    () => `${label} added as unscheduled.`,
  );
}

export function commitRemoveUnscheduled(
  input: RemoveUnscheduledInput,
  label: string,
  act: (input: RemoveUnscheduledInput) => Promise<ActionState> = removeUnscheduled,
): Promise<Outcome> {
  return settle(
    () => act({ recordId: input.recordId, reason: input.reason.trim() }),
    () => `${label} removed.`,
  );
}

// Rows nobody has recorded: what a bulk entry can still write.
export function unrecordedWorkerIds(rows: DayRow[]): string[] {
  return rows.filter((row) => row.state === "unrecorded").map((r) => r.workerId);
}

// The ticked rows that are still unrecorded: a row recorded meanwhile (by this
// admin or another) silently drops out of the selection.
export function selectedUnrecordedIds(
  rows: DayRow[],
  selected: ReadonlySet<string>,
): string[] {
  return unrecordedWorkerIds(rows).filter((id) => selected.has(id));
}

export type CorrectionDraft = {
  status: AttendanceStatus;
  shiftDefinitionId: string;
  reason: string;
};

// The correction form starts from what is on screen with an empty reason.
export function draftOf(row: DayRow): CorrectionDraft {
  return {
    status: row.record?.status ?? "present",
    shiftDefinitionId: row.record?.shiftDefId ?? "",
    reason: "",
  };
}

export function correctionChanged(row: DayRow, draft: CorrectionDraft): boolean {
  return (
    draft.status !== row.record?.status ||
    draft.shiftDefinitionId !== row.record?.shiftDefId
  );
}

// A correction needs something changed AND a reason: the server refuses both
// otherwise, so the button simply stays disabled.
export function canSubmitCorrection(
  row: DayRow,
  draft: CorrectionDraft,
): boolean {
  return correctionChanged(row, draft) && draft.reason.trim() !== "";
}

// The expected values are what the admin saw on screen, so a row changed in
// the meantime answers "reload" instead of being overwritten. Only the changed
// fields are sent.
export function buildCorrectionInput(
  row: DayRow,
  draft: CorrectionDraft,
): CorrectInput {
  const record = row.record!;
  return {
    recordId: record.id,
    expectedStatus: record.status,
    expectedShiftDefinitionId: record.shiftDefId,
    ...(draft.status !== record.status ? { status: draft.status } : {}),
    ...(draft.shiftDefinitionId !== record.shiftDefId
      ? { shiftDefinitionId: draft.shiftDefinitionId }
      : {}),
    reason: draft.reason.trim(),
  };
}

// The pickers of the dialogs. A worker already on the day's list (rostered or
// recorded) is not a candidate: a rostered worker is changed on its own row.
export function candidatesFor<T extends { id: string }>(
  candidates: T[],
  excludeWorkerIds: readonly string[],
): T[] {
  const excluded = new Set(excludeWorkerIds);
  return candidates.filter((c) => !excluded.has(c.id));
}

// Only a live, active shift or area can be picked for a new recording.
export function selectable<T extends { selectable: boolean }>(items: T[]): T[] {
  return items.filter((item) => item.selectable);
}

// The selectable options plus the one a row already holds, so a retired shift
// still shows its label in the picker of the row that was recorded on it.
export function withCurrent<T extends { id: string; selectable: boolean }>(
  items: T[],
  currentId: string,
): T[] {
  return items.filter((item) => item.selectable || item.id === currentId);
}

export type UnscheduledDraft = {
  workerId: string;
  workAreaId: string;
  shiftDefinitionId: string;
  status: AttendanceStatus;
  reason: string;
};

export function canSubmitUnscheduled(draft: UnscheduledDraft): boolean {
  return (
    draft.workerId !== "" &&
    draft.workAreaId !== "" &&
    draft.shiftDefinitionId !== "" &&
    draft.reason.trim() !== ""
  );
}

export function buildUnscheduledInput(
  date: string,
  draft: UnscheduledDraft,
): AddUnscheduledInput {
  return {
    date,
    workerId: draft.workerId,
    workAreaId: draft.workAreaId,
    shiftDefinitionId: draft.shiftDefinitionId,
    status: draft.status,
    reason: draft.reason.trim(),
  };
}
