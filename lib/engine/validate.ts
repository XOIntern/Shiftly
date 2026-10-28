import type { EffectiveRules, RosterAssignment, RuleKey } from "@/types/engine";
import { dayFromNumber, dayNumber, mondayOf, monthKey } from "@/lib/dates";
import type { WorkerProfile } from "@/types/worker";

// Pure validator for draft rosters over the effective rules C1–C7.
// No DB, no Next, no clock — assignments + worker profiles + resolved rules
// in, violations out. Rules enter only via the `rules` parameter: a site
// with c1 = 6 legitimately allows 6 work days per week.
//
// The engine speaks ordered shift definitions: `shiftOrder` holds
// shift-definition ids by order index and C3/C4 compare indices into it.
// A shiftDefId outside shiftOrder is flagged (rule "C3", "unknown shift")
// to fail closed on bad input, and stays rotation-neutral. Cross-plan
// history enters as extra rows of the same `assignments` array.

// The loaders emit one input row per (worker, eligible area) pair, so the
// same id can appear several times with a per-area slice of positions. The
// validator must judge the worker's FULL qualification set (C7 evaluates it
// against each assignment's area), so the per-worker profile is built by
// unioning positionIds across all pairs of one id — first pair wins the
// workAreaId (the record's area is never read; C7 uses the assignment's).
export function buildWorkersRecord(
  workers: Iterable<{
    id: string;
    workAreaId: string;
    positionIds: readonly string[];
  }>,
): Record<string, WorkerProfile> {
  const record: Record<string, WorkerProfile> = {};
  for (const w of workers) {
    const merged = record[w.id];
    record[w.id] = merged
      ? {
          workAreaId: merged.workAreaId,
          positionIds: [...new Set([...merged.positionIds, ...w.positionIds])],
        }
      : { workAreaId: w.workAreaId, positionIds: w.positionIds };
  }
  return record;
}

export interface Violation {
  rule: RuleKey;
  workerId: string;
  date?: string;
  message: string;
}

export function validateRoster(
  assignments: RosterAssignment[],
  workers: Record<string, WorkerProfile>,
  rules: EffectiveRules,
  shiftOrder: readonly string[],
  areaRequirements: Record<string, readonly string[]>,
  shiftLabels?: Readonly<Record<string, string>>,
): Violation[] {
  const violations: Violation[] = [];
  const indexOf = new Map<string, number>(
    shiftOrder.map((id, i) => [id, i] as const),
  );

  // workerId -> assignments in date order. One shift per worker-day is the
  // roster domain (a draft roster assigns at most one shift per day).
  const byWorker = new Map<string, RosterAssignment[]>();
  for (const a of assignments) {
    if (!indexOf.has(a.shiftDefId)) {
      violations.push({
        rule: "C3",
        workerId: a.workerId,
        date: a.date,
        message: "unknown shift",
      });
      continue;
    }
    const list = byWorker.get(a.workerId);
    if (list) list.push(a);
    else byWorker.set(a.workerId, [a]);
  }

  for (const [workerId, list] of byWorker) {
    // Chronological per-worker walk; every rule reads the same sequence.
    const days = [...list].sort((a, b) => a.date.localeCompare(b.date));
    checkWeekLimit(days, workerId, rules, violations);
    checkMonthLimit(days, workerId, rules, violations);
    checkRotation(days, workerId, rules, violations, indexOf, shiftLabels);
    checkRestAfterLastShift(days, workerId, rules, violations, indexOf);
    checkMandatoryBreak(days, workerId, rules, violations);
    checkQualification(
      days,
      workerId,
      workers[workerId],
      rules,
      areaRequirements,
      violations,
    );
  }

  return violations;
}

// C1: at most c1 work days per Monday-start week; the day that pushes the
// worker over the effective limit is the violation.
function checkWeekLimit(
  days: RosterAssignment[],
  workerId: string,
  rules: EffectiveRules,
  violations: Violation[],
): void {
  const counts = new Map<string, number>();
  for (const a of days) {
    const week = mondayOf(a.date);
    const count = (counts.get(week) ?? 0) + 1;
    counts.set(week, count);
    if (count > rules.c1.value) {
      violations.push({
        rule: "C1",
        workerId,
        date: a.date,
        message: `${a.date} is work day ${count} of the week starting ${week}; max is ${rules.c1.value}`,
      });
    }
  }
}

// C2: at most c2 work days per calendar month, same flag-the-excess-day rule.
function checkMonthLimit(
  days: RosterAssignment[],
  workerId: string,
  rules: EffectiveRules,
  violations: Violation[],
): void {
  const counts = new Map<string, number>();
  for (const a of days) {
    const month = monthKey(a.date);
    const count = (counts.get(month) ?? 0) + 1;
    counts.set(month, count);
    if (count > rules.c2.value) {
      violations.push({
        rule: "C2",
        workerId,
        date: a.date,
        message: `${a.date} is work day ${count} of ${month}; max is ${rules.c2.value}`,
      });
    }
  }
}

// C3: rotation must not downshift — the order index of an assignment must
// not be lower than the previous day's (a rest day between resets).
function checkRotation(
  days: RosterAssignment[],
  workerId: string,
  rules: EffectiveRules,
  violations: Violation[],
  indexOf: ReadonlyMap<string, number>,
  shiftLabels?: Readonly<Record<string, string>>,
): void {
  if (!rules.c3.value) return;
  // A shift missing from the lookup (or no lookup) reads as its raw id.
  const label = (id: string) => shiftLabels?.[id] ?? id;
  let prev: RosterAssignment | undefined;
  for (const a of days) {
    if (
      prev &&
      dayNumber(a.date) - dayNumber(prev.date) === 1 &&
      indexOf.get(a.shiftDefId)! < indexOf.get(prev.shiftDefId)!
    ) {
      violations.push({
        rule: "C3",
        workerId,
        date: a.date,
        message: `Shift downshift from ${label(prev.shiftDefId)} to ${label(a.shiftDefId)} on consecutive days (${prev.date} → ${a.date})`,
      });
    }
    prev = a;
  }
}

// C4: the day immediately after the last shift in the order must be a rest
// day; working on exactly that day violates.
function checkRestAfterLastShift(
  days: RosterAssignment[],
  workerId: string,
  rules: EffectiveRules,
  violations: Violation[],
  indexOf: ReadonlyMap<string, number>,
): void {
  if (!rules.c4.value) return;
  const assigned = new Set(days.map((a) => a.date));
  const lastIndex = indexOf.size - 1;
  if (lastIndex < 0) return;
  for (const a of days) {
    if (indexOf.get(a.shiftDefId) !== lastIndex) continue;
    const next = dayFromNumber(dayNumber(a.date) + 1);
    if (assigned.has(next)) {
      violations.push({
        rule: "C4",
        workerId,
        date: next,
        message: `Works ${next}, the day immediately after the last shift (${a.date})`,
      });
    }
  }
}

// C5/C6: once c5 accumulated work days are reached, the next c6 calendar
// days are an owed break. Only ASSIGNED days inside that window violate, so
// a break owed past the roster horizon is never flagged. The debt settles
// once the window has fully passed and accumulation restarts.
function checkMandatoryBreak(
  days: RosterAssignment[],
  workerId: string,
  rules: EffectiveRules,
  violations: Violation[],
): void {
  const c5 = rules.c5.value;
  const c6 = rules.c6.value;
  if (c5 <= 0 || c6 <= 0) return; // degenerate config owes no break
  let accumulated = 0;
  let owedFrom: number | null = null; // first day-number of the owed window
  for (const a of days) {
    const day = dayNumber(a.date);
    if (owedFrom !== null) {
      if (day < owedFrom + c6) {
        violations.push({
          rule: "C5",
          workerId,
          date: a.date,
          message: `Assigned on ${a.date} inside the mandatory ${c6}-day break owed after ${c5} accumulated work days`,
        });
        continue;
      }
      owedFrom = null; // window passed; the debt is settled either way
      accumulated = 0;
    }
    accumulated += 1;
    if (accumulated === c5) owedFrom = day + 1;
  }
}

// C7: an area whose requirement set is non-empty requires the worker to
// hold at least one of the required positions. Empty sets and profiles the
// worker data does not cover skip the check (no qualification data to
// compare — c7 only bites where requirements are actually declared).
function checkQualification(
  days: RosterAssignment[],
  workerId: string,
  profile: WorkerProfile | undefined,
  rules: EffectiveRules,
  areaRequirements: Record<string, readonly string[]>,
  violations: Violation[],
): void {
  if (!rules.c7.value || !profile) return;
  for (const a of days) {
    const required = areaRequirements[a.workAreaId];
    if (!required || required.length === 0) continue;
    if (!required.some((p) => profile.positionIds.includes(p))) {
      violations.push({
        rule: "C7",
        workerId,
        date: a.date,
        message: `Assigned to ${a.workAreaId} on ${a.date} without any required position`,
      });
    }
  }
}
