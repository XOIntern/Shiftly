import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "./db";
import type { DbExecutor } from "./db";
import { rosterAssignment, rosterPlan } from "../drizzle/schema";
import { mondayOf, weekDates } from "./week";
import {
  buildWorkersRecord,
  crossPlanDayConflicts,
  validateRoster,
} from "./engine/validate";
import type { Violation } from "./engine/validate";
import type { EffectiveRules, RosterAssignment } from "@/types/engine";
import type { ActionState } from "@/types/action-state";
import {
  loadAreaNames,
  loadAreaRequirements,
  loadDailyAssignmentsInRange,
  loadPriorAssignments,
  loadShiftLabels,
  loadShiftOrder,
  loadWorkerProfiles,
} from "./roster-data";
import { recordRosterAudit } from "./roster-audit";

// The raw roster-plan mutation machinery (moved from
// app/dashboard/roster/actions.ts): in a "use server" module EVERY export
// becomes a network-reachable endpoint, so the unscoped primitives lived
// there as an auth bypass. They live in this plain module instead; the
// actions file exposes only thin, session-checked wrappers (the revise UI
// flow enters through the guarded `revisePlan` action, never through this
// module directly).

// Thrown to abort one of the mutations' transactions with an already-built
// ActionState: a returned value would commit the half-done write — a throw
// is the only rollback (pattern: the request actions' ActionAbort).
export class ActionAbort extends Error {
  constructor(readonly state: ActionState) {
    super("action aborted");
  }
}

const NOT_FOUND = "Roster not found.";
const DAILY_FILLS_EXIST =
  "Daily fills exist for this week — clear them before revising";

// The editor's inline-violations envelope: a saved edit is always ok — the
// violations drive the inline warning, they do not refuse the write.
export type SetAssignmentInput = {
  planId: string;
  workerId: string;
  date: string;
  shiftDefId: string | null;
  // Required for an upsert (the row is area-welded); a delete needs none.
  workAreaId?: string;
};

export type SetAssignmentResult = ActionState & {
  data?: { violations: Violation[] };
};

// Copy-on-edit gate: a published plan is never edited in place — editing
// clones it (version+1, draft, published fields NULL) with its rows and
// returns the new plan id; a draft returns unchanged. One transaction, one
// audit entry (roster.revise). Caller decides the audit actor: the revise
// UI flow passes the clicking admin's id (resolved by the guarded action).
export async function ensureDraftVersion(
  planId: string,
  actorId?: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(rosterPlan)
      .where(eq(rosterPlan.id, planId))
      .limit(1)
      .for("update");
    if (!plan) throw new ActionAbort({ ok: false, message: NOT_FOUND });

    // Decision-7 invariant: a draft weekly plan may never coexist with
    // daily plans covering the same week — the publish gate is blind to
    // the daily rows, so a revise over that mix could publish a week it
    // cannot actually validate. The smallest correct step is to refuse the
    // revise until the daily fills are cleared.
    if (plan.kind === "weekly") {
      const days = weekDates(plan.weekStart as string);
      const [daily] = await tx
        .select({ id: rosterPlan.id })
        .from(rosterPlan)
        .where(
          and(
            eq(rosterPlan.siteLocationId, plan.siteLocationId),
            eq(rosterPlan.kind, "daily"),
            gte(rosterPlan.requestDate, days[0]),
            lte(rosterPlan.requestDate, days[6]),
          ),
        )
        .limit(1);
      if (daily) {
        throw new ActionAbort({ ok: false, message: DAILY_FILLS_EXIST });
      }
    }

    if (plan.status === "draft") return plan.id;

    const auditor = actorId ?? plan.generatedBy;
    if (!auditor) {
      throw new Error("ensureDraftVersion needs an actor for the audit trail");
    }

    const [clone] = await tx
      .insert(rosterPlan)
      .values({
        siteId: plan.siteId,
        siteLocationId: plan.siteLocationId,
        kind: plan.kind,
        weekStart: plan.weekStart,
        requestDate: plan.requestDate,
        status: "draft",
        version: plan.version + 1,
        rulesSnapshot: plan.rulesSnapshot,
        sourceRequestId: plan.sourceRequestId,
        generatedBy: auditor,
      })
      .returning({ id: rosterPlan.id, version: rosterPlan.version });

    const rows = await tx
      .select({
        workerId: rosterAssignment.workerId,
        workAreaId: rosterAssignment.workAreaId,
        shiftDefinitionId: rosterAssignment.shiftDefinitionId,
        date: rosterAssignment.date,
        siteId: rosterAssignment.siteId,
        siteLocationId: rosterAssignment.siteLocationId,
      })
      .from(rosterAssignment)
      .where(eq(rosterAssignment.planId, plan.id));
    if (rows.length > 0) {
      await tx.insert(rosterAssignment).values(
        rows.map((r) => ({
          planId: clone.id,
          siteId: r.siteId,
          siteLocationId: r.siteLocationId,
          workerId: r.workerId,
          workAreaId: r.workAreaId,
          shiftDefinitionId: r.shiftDefinitionId,
          date: r.date,
        })),
      );
    }

    await recordRosterAudit(tx, {
      actorId: auditor,
      action: "roster.revise",
      siteId: plan.siteId,
      siteLocationId: plan.siteLocationId,
      details: { planId: plan.id, newPlanId: clone.id, version: clone.version },
    });

    return clone.id;
  });
}

// Retroactive rule tightening must not deadlock future publishes: the
// merged evaluation keeps the prior history, but only violations dated
// INSIDE the plan's own horizon (its Monday-start week) block — the rows a
// publish can actually change. Violations on prior (immutable, published)
// dates are historical: surfaced as warnings, never blocking. Undated
// violations always block.
export function splitViolationsByHorizon(
  violations: Violation[],
  plan: {
    kind: "weekly" | "daily";
    weekStart: string | null;
    requestDate: string | null;
  },
): { blocking: Violation[]; historical: Violation[] } {
  const horizon = new Set(
    weekDates(
      plan.kind === "weekly"
        ? (plan.weekStart as string)
        : mondayOf(plan.requestDate as string),
    ),
  );
  const blocking = violations.filter(
    (v) => v.date === undefined || horizon.has(v.date),
  );
  const historical = violations.filter(
    (v) => v.date !== undefined && !horizon.has(v.date),
  );
  return { blocking, historical };
}

// The plan's rows validated over the merged context: plan rows (the current
// side) + prior published history strictly before the plan's horizon, rules
// from the plan's own snapshot (the editor judges by the rules the draft
// was generated with; publish re-checks against the RESOLVED ones). A weekly
// plan is also validated together with the daily fills of its week (they are
// context, never part of the plan's rows), and a worker holding a row in both
// is reported by name and date. The page's publish-gate summary reuses this —
// the SAME semantics the edit envelope rides on, never a divergent
// reimplementation.
export async function planViolations(
  siteLocationId: string,
  rules: EffectiveRules,
  rows: RosterAssignment[],
  // A caller holding a transaction passes its handle so the loaders run on
  // that connection: through the pool, each held connection would wait on up
  // to six more and concurrent edits could starve it.
  executor: DbExecutor = db,
  kind: "weekly" | "daily" = "weekly",
): Promise<Violation[]> {
  const weekStart = mondayOf(rows[0]?.date ?? "1970-01-05");
  // One connection runs one query at a time (pg is dropping its query
  // queue): on a caller's transaction the loaders go in sequence, on the pool
  // they overlap.
  let tail: Promise<unknown> = Promise.resolve();
  const load = <T>(fn: () => Promise<T>): Promise<T> => {
    if (executor === db) return fn();
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  };
  const [
    shiftOrder,
    shiftLabels,
    areaNames,
    areaRequirements,
    profiles,
    prior,
    dailyRows,
  ] = await Promise.all([
      load(() => loadShiftOrder(siteLocationId, executor)),
      load(() => loadShiftLabels(siteLocationId, executor)),
      load(() => loadAreaNames(siteLocationId, executor)),
      load(() => loadAreaRequirements(siteLocationId, executor)),
      load(() => loadWorkerProfiles(siteLocationId, undefined, executor)),
      load(() => loadPriorAssignments(siteLocationId, weekDates(weekStart)[0], executor)),
      kind === "weekly"
        ? load(() =>
            loadDailyAssignmentsInRange(
              siteLocationId,
              weekDates(weekStart)[0],
              weekDates(weekStart)[6],
              executor,
            ),
          )
        : Promise.resolve([] as RosterAssignment[]),
    ]);
  const employeeIds = new Map(profiles.map((p) => [p.id, p.employeeId]));
  const employeeOf = (workerId: string) => employeeIds.get(workerId) ?? workerId;
  const week = weekDates(weekStart);
  const planWorkers = new Set(rows.map((r) => r.workerId));
  const found = validateRoster(
    [...rows, ...dailyRows, ...prior],
    buildWorkersRecord(profiles),
    rules,
    shiftOrder,
    areaRequirements,
    shiftLabels,
    areaNames,
  );
  // A violation inside the week that only involves daily fills (the worker
  // has no row in this plan) is not this plan's to fix — daily fills cannot
  // be removed — so it must not block the weekly plan, e.g. after a rule was
  // tightened. Anything dated outside the week stays, as a historical warning.
  const own =
    kind === "weekly"
      ? found.filter(
          (v) =>
            planWorkers.has(v.workerId) ||
            v.date === undefined ||
            v.date < week[0] ||
            v.date > week[6],
        )
      : found;
  return [
    // Name the worker: the plan's grid shows a row per worker, but the
    // refusal message is read on its own.
    ...own.map((v) => ({ ...v, message: `${employeeOf(v.workerId)}: ${v.message}` })),
    ...crossPlanDayConflicts(rows, dailyRows, employeeOf),
  ];
}

// The write half of the guarded `setAssignment` action, its own transaction.
// Plain-module (not a server action): tests drive it directly so the
// copy-on-edit guard can be exercised with a plan id that turned published
// mid-edit — a window no sequential run through the action can hit.
export async function applyAssignmentEdit(
  planId: string,
  input: SetAssignmentInput,
): Promise<SetAssignmentResult> {
  try {
    return await db.transaction(async (tx): Promise<SetAssignmentResult> => {
      // Re-read under a row lock and re-assert the draft status: a publish
      // wedged between ensureDraftVersion and this write must NOT let the
      // edit land in place on a now-published plan.
      const [plan] = await tx
        .select()
        .from(rosterPlan)
        .where(eq(rosterPlan.id, planId))
        .limit(1)
        .for("update");
      if (!plan) throw new ActionAbort({ ok: false, message: NOT_FOUND });
      if (plan.status !== "draft") {
        throw new ActionAbort({
          ok: false,
          message: "Plan was published while editing, retry",
        });
      }

      if (input.shiftDefId === null) {
        // Delete: clear the worker's shift for that day.
        await tx
          .delete(rosterAssignment)
          .where(
            and(
              eq(rosterAssignment.planId, planId),
              eq(rosterAssignment.workerId, input.workerId),
              eq(rosterAssignment.date, input.date),
            ),
          );
      } else {
        if (!input.workAreaId) {
          throw new ActionAbort({
            ok: false,
            fieldErrors: { workAreaId: "Work area is required" },
          });
        }
        // Upsert: the (plan, worker, date) unique makes a same-slot edit a
        // place-shift-on-conflict write.
        await tx
          .insert(rosterAssignment)
          .values({
            planId,
            siteId: plan.siteId,
            siteLocationId: plan.siteLocationId,
            workerId: input.workerId,
            workAreaId: input.workAreaId,
            shiftDefinitionId: input.shiftDefId,
            date: input.date,
          })
          .onConflictDoUpdate({
            target: [
              rosterAssignment.planId,
              rosterAssignment.workerId,
              rosterAssignment.date,
            ],
            set: {
              shiftDefinitionId: input.shiftDefId,
              workAreaId: input.workAreaId,
            },
          });
      }

      const rows: RosterAssignment[] = (
        await tx
          .select({
            workerId: rosterAssignment.workerId,
            date: rosterAssignment.date,
            shiftDefinitionId: rosterAssignment.shiftDefinitionId,
            workAreaId: rosterAssignment.workAreaId,
          })
          .from(rosterAssignment)
          .where(eq(rosterAssignment.planId, planId))
      ).map((r) => ({
        workerId: r.workerId,
        date: r.date,
        shiftDefId: r.shiftDefinitionId,
        workAreaId: r.workAreaId,
      }));
      const violations = await planViolations(
        plan.siteLocationId,
        plan.rulesSnapshot as EffectiveRules,
        rows,
        tx,
        plan.kind,
      );

      return { ok: true, data: { violations } };
    });
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    throw err; // unexpected driver errors surface to the caller's net
  }
}
