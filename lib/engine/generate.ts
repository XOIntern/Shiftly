import type {
  EffectiveRules,
  RosterAssignment,
} from "@/types/engine";
import type { WorkerProfile } from "@/types/worker";
import { dayNumber, mondayOf, monthKey } from "./dates";
import { validateRoster } from "./validate";
import { buildWorkersRecord } from "./validate";

// Pure deterministic draft generator over the effective rules C1–C7.
// No DB, no Next, no clock, and NO randomness: two runs on identical input
// are byte-equal because every ordering is pinned by an explicit sortKey
// (week count → month count → days since last shift, desc → employeeId).
// Rules enter only via the `rules` parameter.
//
// One requirement line = one date × one shift definition × one work area ×
// `headcount` distinct workers. The candidate admission loop is validator-
// driven: append the candidate to this worker's merged horizon (current
// draft + prior history) → `validateRoster` over that worker's assignments
// → any violation rejects the candidate and advances to the next.

export interface RequirementLine {
  workAreaId: string;
  shiftDefId: string;
  date: string; // "YYYY-MM-DD"
  headcount: number;
}

// Why a slot could not be filled:
// - "no_qualified_candidate": nobody with a required position was available
//   (C7 filtered everyone out).
// - "all_rule_limited": qualified candidates existed but the ruleset
//   rejected every one of them.
// - "unfilled": no engine attempt was made (computeDeficit cannot know why).
export interface Deficit {
  workAreaId: string;
  shiftDefId: string;
  date: string;
  missing: number;
  reason: "no_qualified_candidate" | "all_rule_limited" | "unfilled";
}

// A roster-eligible worker: identity + employee number + profile.
export type GeneratorWorker = { id: string; employeeId: string } & WorkerProfile;

export interface GenerateInput {
  requirements: RequirementLine[];
  workers: GeneratorWorker[];
  shiftOrder: readonly string[];
  areaRequirements: Record<string, readonly string[]>;
  priorAssignments: RosterAssignment[];
  rules: EffectiveRules;
}

// A slot candidate that survived the validator, with a human-readable load
// summary: the work-day count in the target's Monday-start week, then the
// work-day count in the target's month window.
export interface SuggestedCandidate {
  workerId: string;
  employeeId: string;
  reason: string;
}

const NEVER_WORKED = 1_000_000; // sorts before any real "days since" gap

// Deterministic load key of a worker for a target date, ascending:
// work days in the target's Monday-start week → work days in the target's
// month → days since the worker's last assignment (DESC, so negated) —
// ties broken by employeeId lexicographically at the comparator level.
export function sortKey(
  worker: { id: string; employeeId: string },
  targetDate: string,
  currentAssignments: RosterAssignment[],
): number[] {
  const own = currentAssignments.filter((a) => a.workerId === worker.id);
  const targetWeek = mondayOf(targetDate);
  const targetMonth = monthKey(targetDate);
  const week = own.reduce((n, a) => n + (mondayOf(a.date) === targetWeek ? 1 : 0), 0);
  const month = own.reduce((n, a) => n + (monthKey(a.date) === targetMonth ? 1 : 0), 0);
  const target = dayNumber(targetDate);
  const last = own.reduce((max, a) => Math.max(max, dayNumber(a.date)), Number.NEGATIVE_INFINITY);
  const sinceLast = Number.isFinite(last) ? target - last : NEVER_WORKED;
  return [week, month, -sinceLast];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// Rank a candidate pool by sortKey (then employeeId). `assignmentsByWorker`
// holds each worker's own horizon rows (this plan + prior history); keys are
// computed once per worker, not inside the comparator.
export function rankWorkers(
  workers: readonly GeneratorWorker[],
  targetDate: string,
  assignmentsByWorker: ReadonlyMap<string, RosterAssignment[]>,
): GeneratorWorker[] {
  const keyed = workers.map((w) => ({
    w,
    key: sortKey(w, targetDate, assignmentsByWorker.get(w.id) ?? []),
  }));
  keyed.sort((a, b) => {
    const cmp = compareKeys(a.key, b.key);
    return cmp !== 0 ? cmp : a.w.employeeId.localeCompare(b.w.employeeId);
  });
  return keyed.map((k) => k.w);
}

// C7 gate used both for admission (the validator re-checks it) and for the
// deficit reason split: qualification problems are reported differently
// from rule limits.
function isQualified(
  worker: GeneratorWorker,
  workAreaId: string,
  rules: EffectiveRules,
  areaRequirements: Record<string, readonly string[]>,
): boolean {
  if (!rules.c7.value) return true;
  const required = areaRequirements[workAreaId];
  if (!required || required.length === 0) return true;
  return required.some((p) => worker.positionIds.includes(p));
}

// Validate one candidate against this worker's merged horizon (current plan
// + prior history + the candidate row itself). Clean → admit.
function admitsCandidate(
  worker: GeneratorWorker,
  candidate: RosterAssignment,
  horizon: RosterAssignment[],
  workersRecord: Record<string, WorkerProfile>,
  rules: EffectiveRules,
  shiftOrder: readonly string[],
  areaRequirements: Record<string, readonly string[]>,
): boolean {
  const merged = [...(horizon ?? []), candidate];
  const violations = validateRoster(
    merged,
    { [worker.id]: workersRecord[worker.id] },
    rules,
    shiftOrder,
    areaRequirements,
  );
  return violations.length === 0;
}

export function generateDraft(input: GenerateInput): {
  assignments: RosterAssignment[];
  deficits: Deficit[];
} {
  const { requirements, workers, shiftOrder, areaRequirements, priorAssignments, rules } = input;

  const workersRecord = buildWorkersRecord(workers);

  // Merged horizon per worker, seeded with prior history and grown as the
  // draft fills in — both feed sortKey and the admission loop.
  const horizonByWorker = new Map<string, RosterAssignment[]>();
  for (const a of priorAssignments) {
    const list = horizonByWorker.get(a.workerId);
    if (list) list.push(a);
    else horizonByWorker.set(a.workerId, [a]);
  }

  // Candidate pools per work area, in stable input order.
  const byArea = new Map<string, GeneratorWorker[]>();
  for (const w of workers) {
    const list = byArea.get(w.workAreaId);
    if (list) list.push(w);
    else byArea.set(w.workAreaId, [w]);
  }

  const assignments: RosterAssignment[] = [];
  const deficits: Deficit[] = [];

  for (const req of requirements) {
    const pool = byArea.get(req.workAreaId) ?? [];
    const qualified = pool.filter((w) => isQualified(w, req.workAreaId, rules, areaRequirements));
    // Rank by the merged horizon: prior history + what the draft assigned
    // so far, all grouped by workerId.
    const candidates = rankWorkers(qualified, req.date, horizonByWorker);

    let accepted = 0;
    let sawRuleRejection = false;

    for (const worker of candidates) {
      if (accepted >= req.headcount) break;
      const own = horizonByWorker.get(worker.id) ?? [];
      if (own.some((a) => a.date === req.date)) continue; // one shift per worker-day

      const candidate: RosterAssignment = {
        workerId: worker.id,
        date: req.date,
        shiftDefId: req.shiftDefId,
        workAreaId: req.workAreaId,
      };

      if (admitsCandidate(worker, candidate, own, workersRecord, rules, shiftOrder, areaRequirements)) {
        own.push(candidate);
        horizonByWorker.set(worker.id, own);
        assignments.push(candidate);
        accepted += 1;
      } else {
        sawRuleRejection = true;
      }
    }

    if (accepted < req.headcount) {
      deficits.push({
        workAreaId: req.workAreaId,
        shiftDefId: req.shiftDefId,
        date: req.date,
        missing: req.headcount - accepted,
        // A qualified pool that never even got rejected (too small, or all
        // filtered by C7) is a qualification problem; otherwise the rules
        // ate the candidates.
        reason: sawRuleRejection ? "all_rule_limited" : "no_qualified_candidate",
      });
    }
  }

  return { assignments, deficits };
}
