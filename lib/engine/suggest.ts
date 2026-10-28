import type { EffectiveRules, RosterAssignment } from "@/types/engine";
import { mondayOf, monthKey, dayNumber } from "../dates";
import type {
  GeneratorWorker,
  RequirementLine,
  SuggestedCandidate,
} from "./generate";
import { rankWorkers } from "./generate";
import { validateRoster } from "./validate";
import { buildWorkersRecord } from "./validate";

// Pure replacement suggester: for one unfilled requirement line, rank the
// area's workers by the generator's sortKey and return at most `limit`
// validator-clean candidates with a human-readable load summary. No DB, no
// Next, no clock — history enters as plain assignment rows (this week's
// plan rows in `weeklyAssignments`, cross-plan rows in `priorAssignments`).

// "2 work days this week, 0 in window": week count in the target's
// Monday-start week, then the month-window work-day count that ranked the
// candidate, then the nearest shift on either side of the target date.
function describeLoad(own: RosterAssignment[], targetDate: string): string {
  const targetWeek = mondayOf(targetDate);
  const targetMonth = monthKey(targetDate);
  const week = own.reduce(
    (n, a) => n + (mondayOf(a.date) === targetWeek ? 1 : 0),
    0,
  );
  const month = own.reduce(
    (n, a) => n + (monthKey(a.date) === targetMonth ? 1 : 0),
    0,
  );
  const target = dayNumber(targetDate);
  let before = Number.NEGATIVE_INFINITY;
  let after = Number.POSITIVE_INFINITY;
  for (const a of own) {
    const day = dayNumber(a.date);
    if (day < target) before = Math.max(before, day);
    else if (day > target) after = Math.min(after, day);
  }
  const daysBefore = target - before;
  const daysAfter = after - target;
  const prefix = `${week} work days this week, ${month} in window`;
  if (!Number.isFinite(before) && !Number.isFinite(after)) {
    return `${prefix}, no prior shifts`;
  }
  // Nearest shift wins; a tie prefers the earlier one.
  return daysBefore <= daysAfter
    ? `${prefix}, last shift ${daysBefore}d ago`
    : `${prefix}, next shift in ${daysAfter}d`;
}

export function suggestReplacements(
  line: RequirementLine,
  weeklyAssignments: RosterAssignment[],
  priorAssignments: RosterAssignment[],
  workers: GeneratorWorker[],
  shiftOrder: readonly string[],
  areaRequirements: Record<string, readonly string[]>,
  rules: EffectiveRules,
  limit: number,
): SuggestedCandidate[] {
  const history = [...weeklyAssignments, ...priorAssignments];
  const byWorker = new Map<string, RosterAssignment[]>();
  for (const a of history) {
    const list = byWorker.get(a.workerId);
    if (list) list.push(a);
    else byWorker.set(a.workerId, [a]);
  }

  const workersRecord = buildWorkersRecord(workers);

  // Area pool narrowed to the line's exact position (#143), ranked exactly
  // like the generator ranks its greedy picks.
  const pool = workers.filter(
    (w) =>
      w.workAreaId === line.workAreaId &&
      w.positionIds.includes(line.positionId),
  );
  const ranked = rankWorkers(pool, line.date, byWorker);

  const suggested: SuggestedCandidate[] = [];
  for (const worker of ranked) {
    if (suggested.length >= limit) break;
    const own = byWorker.get(worker.id) ?? [];
    if (own.some((a) => a.date === line.date)) continue; // one shift per worker-day

    const candidate: RosterAssignment = {
      workerId: worker.id,
      date: line.date,
      shiftDefId: line.shiftDefId,
      workAreaId: line.workAreaId,
    };
    const violations = validateRoster(
      [...own, candidate],
      { [worker.id]: workersRecord[worker.id] },
      rules,
      shiftOrder,
      areaRequirements,
    );
    if (violations.length === 0) {
      suggested.push({
        workerId: worker.id,
        employeeId: worker.employeeId,
        reason: describeLoad(own, line.date),
      });
    }
  }
  return suggested;
}
