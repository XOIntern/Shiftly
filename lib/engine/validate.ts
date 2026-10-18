import type { EffectiveRules, RuleKey } from "./types";

// Pure validator for draft rosters over the effective rules C1–C7.
// No DB, no Next, no clock — assignments + worker profiles + resolved rules
// in, violations out. Rules enter only via the `rules` parameter: a site
// with c1 = 6 legitimately allows 6 work days per week.

export type Shift = 1 | 2 | 3;

export interface RosterAssignment {
  workerId: string;
  date: string; // "YYYY-MM-DD"
  shift: Shift;
  departmentId: string;
}

export interface WorkerProfile {
  departmentId: string;
}

export interface Violation {
  rule: RuleKey;
  workerId: string;
  date?: string;
  message: string;
}

// Day-number of a "YYYY-MM-DD" date: days since 1970-01-01, UTC. Pure
// string/number math — deterministic, no Date.now, no timezone drift.
const dayNumber = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

const dayFromNumber = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

// 1970-01-05 is the first Monday of the epoch (day-number 4), so this maps
// any date onto its Monday-start week (architecture: weeks start Monday).
const mondayOf = (date: string): string => {
  const n = dayNumber(date);
  return dayFromNumber(n - (((n - 4) % 7) + 7) % 7);
};

const monthKey = (date: string): string => date.slice(0, 7);

export function validateRoster(
  assignments: RosterAssignment[],
  workers: Record<string, WorkerProfile>,
  rules: EffectiveRules,
): Violation[] {
  const violations: Violation[] = [];

  // workerId -> assignments in date order. One shift per worker-day is the
  // roster domain (a draft roster assigns at most one shift per day).
  const byWorker = new Map<string, RosterAssignment[]>();
  for (const a of assignments) {
    const list = byWorker.get(a.workerId);
    if (list) list.push(a);
    else byWorker.set(a.workerId, [a]);
  }

  for (const [workerId, list] of byWorker) {
    // Chronological per-worker walk; every rule reads the same sequence.
    const days = [...list].sort((a, b) => a.date.localeCompare(b.date));
    checkWeekLimit(days, workerId, rules, violations);
    checkMonthLimit(days, workerId, rules, violations);
    checkRotation(days, workerId, rules, violations);
    checkRestAfterShift3(days, workerId, rules, violations);
    checkMandatoryBreak(days, workerId, rules, violations);
    checkDepartment(days, workerId, workers[workerId], rules, violations);
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

// C3: forward rotation 1→2→3 only, on consecutive calendar days (a rest day
// between assignments resets rotation — downshifts across a gap don't count).
function checkRotation(
  days: RosterAssignment[],
  workerId: string,
  rules: EffectiveRules,
  violations: Violation[],
): void {
  if (!rules.c3.value) return;
  let prev: RosterAssignment | undefined;
  for (const a of days) {
    if (prev && dayNumber(a.date) - dayNumber(prev.date) === 1 && a.shift < prev.shift) {
      violations.push({
        rule: "C3",
        workerId,
        date: a.date,
        message: `Shift downshift ${prev.shift}→${a.shift} on consecutive days (${prev.date} → ${a.date})`,
      });
    }
    prev = a;
  }
}

// C4: the day immediately after a shift-3 day must be a rest day; working
// on exactly that day violates.
function checkRestAfterShift3(
  days: RosterAssignment[],
  workerId: string,
  rules: EffectiveRules,
  violations: Violation[],
): void {
  if (!rules.c4.value) return;
  const assigned = new Set(days.map((a) => a.date));
  for (const a of days) {
    if (a.shift !== 3) continue;
    const next = dayFromNumber(dayNumber(a.date) + 1);
    if (assigned.has(next)) {
      violations.push({
        rule: "C4",
        workerId,
        date: next,
        message: `Works ${next}, the day immediately after a shift-3 day (${a.date})`,
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

// C7: assignment department must equal the worker's profile department.
// Workers without a profile can't be checked and are skipped.
function checkDepartment(
  days: RosterAssignment[],
  workerId: string,
  profile: WorkerProfile | undefined,
  rules: EffectiveRules,
  violations: Violation[],
): void {
  if (!rules.c7.value || !profile) return;
  for (const a of days) {
    if (a.departmentId !== profile.departmentId) {
      violations.push({
        rule: "C7",
        workerId,
        date: a.date,
        message: `Assigned to department ${a.departmentId}; worker's department is ${profile.departmentId}`,
      });
    }
  }
}
