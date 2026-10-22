"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  mpRequest,
  rosterAssignment,
  rosterPlan,
  shiftDefinition,
  siteLocation,
  worker,
  workArea,
} from "@/drizzle/schema";
import { db } from "@/lib/db";
import { pgErrorConstraint, pgErrorCode } from "@/error/db-errors";
import { requireUser } from "@/lib/session";
import type { SessionUser } from "@/types/session";
import type { ActionState } from "@/types/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import { mondayOf, weekDates } from "@/lib/week";
import { computeDeficit } from "@/lib/engine/deficit";
import { generateDraft } from "@/lib/engine/generate";
import type { RequirementLine, SuggestedCandidate } from "@/lib/engine/generate";
import { suggestReplacements } from "@/lib/engine/suggest";
import { buildWorkersRecord, validateRoster } from "@/lib/engine/validate";
import type { EffectiveRules } from "@/types/engine";
import type { RosterAssignment, Violation } from "@/lib/engine/validate";
import { loadEffectiveRules } from "@/lib/rule-config";
import {
  loadAreaRequirements,
  loadPlanWithRows,
  loadPriorAssignments,
  loadRequirementsForWeek,
  loadShiftOrder,
  loadWorkerProfiles,
} from "@/lib/roster-data";
import {
  rosterPlanMutationWhere,
  rosterPlanOwnedByActor,
} from "@/lib/roster-scope";
import { recordRosterAudit } from "@/lib/roster-audit";

// Roster actions (roster-engine task 6): the persistence + state machine
// layer over roster_plan/roster_assignment. Every action re-checks the
// session, derives its scope server-side (an admin is pinned to their own
// site_location; an ho is read-only on rosters and refused outright), and
// writes its audit row in the SAME transaction as the data (pattern:
// app/dashboard/requests/actions.ts). Dates are "YYYY-MM-DD" strings.

// Thrown to abort one of the actions' transactions with an already-built
// ActionState: a returned value would commit the half-done write — a throw
// is the only rollback (pattern: the request actions' ActionAbort).
class ActionAbort extends Error {
  constructor(readonly state: ActionState) {
    super("action aborted");
  }
}

export interface GenerateRosterInput {
  weekStart: string;
  workAreaId?: string;
  // Superadmin-only affordance (the dialog's pick); an admin's binding
  // overrides it, exactly like the request actions.
  siteLocationId?: string;
}

export interface SetAssignmentInput {
  planId: string;
  workerId: string;
  date: string;
  shiftDefId: string | null;
  // Required for an upsert (the row is area-welded); a delete needs none.
  workAreaId?: string;
}

export interface FillDailyRequestInput {
  requestId: string;
  workAreaId: string;
  shiftDefId: string;
  date: string;
  workerId: string;
  siteLocationId?: string;
}

export interface SuggestInput {
  workAreaId: string;
  shiftDefId: string;
  date: string;
  siteLocationId?: string;
}

// The editor's inline-violations envelope: a saved edit is always ok — the
// rules Rodgers the inline warning, they do not refuse the write.
export type SetAssignmentResult = ActionState & {
  data?: { violations: Violation[] };
};

// Messages pinned by the plan — the tests assert them verbatim.
const HO_GENERATE_MESSAGE = "Only admins generate rosters";
const HO_EDIT_MESSAGE = "Only admins edit rosters";
const HO_PUBLISH_MESSAGE = "Only admins publish rosters";
const HO_FILL_MESSAGE = "Only admins fill daily requests";
const NO_REQUIREMENTS = "No received requests cover this week";
const DRAFT_EXISTS = "Draft already exists";
const NOT_FOUND = "Roster not found.";
const ALREADY_PUBLISHED = "Roster is already published";
const RACE_MESSAGE = "Roster state changed, reload";
const PUBLISH_FIRST = "Publish the weekly roster first";
const REQUEST_GONE = "Daily request not found.";
const WORKER_UNAVAILABLE = "Worker is not available for this roster";
const REFERENCE_FK =
  "Selected work area or shift must belong to this request's location";
const REFERENCE_GONE = "Selected work area or shift no longer exists";
const ASSIGNMENT_DUPLICATE = "That worker already has a shift on this date";
const DAILY_PLAN_RACE = "A daily plan already exists for this date";

const isDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && z.string().date().safeParse(value).success;

const areIds = (...ids: (string | undefined)[]): boolean =>
  ids.every((id) => id === undefined || z.uuid().safeParse(id).success);

// Admin actors are pinned to their own site_location — anything the client
// sent is ignored. A superadmin keeps the input value (the dialog's pick).
function effectiveSiteLocationId(
  actor: SessionUser,
  inputSiteLocationId?: string,
): string | undefined {
  return actor.role === "admin"
    ? (actor.siteLocationId ?? undefined)
    : (inputSiteLocationId ?? actor.siteLocationId ?? undefined);
}

// siteId is NEVER trusted from the client: it is derived from the plan's
// site_location, so the composite FK pairing is decided server-side. A
// soft-deleted location cannot parent a roster (live-row weld).
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

// Refusal message listing up to 5 violations (constraint: refusals carry
// up to 5 violation messages).
function violationMessage(violations: Violation[]): string {
  return violations
    .slice(0, 5)
    .map((v) => v.message)
    .join("; ");
}

// Engine-shaped value row for one roster_assignment insert.
function assignmentRow(
  planId: string,
  siteId: string,
  siteLocationId: string,
  a: RosterAssignment,
) {
  return {
    planId,
    siteId,
    siteLocationId,
    workerId: a.workerId,
    workAreaId: a.workAreaId,
    shiftDefinitionId: a.shiftDefId,
    date: a.date,
  };
}

export async function generateRoster(
  input: GenerateRosterInput,
): Promise<ActionState> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_GENERATE_MESSAGE };
  }
  if (!isDate(input.weekStart)) {
    return { ok: false, fieldErrors: { weekStart: "Week is required" } };
  }
  // Monday snap: the weekly anchor is the week's Monday regardless of which
  // day of that week the caller named (pattern: the request actions).
  const weekStart = mondayOf(input.weekStart);

  const siteLocationId = effectiveSiteLocationId(actor, input.siteLocationId);
  if (!siteLocationId) {
    return { ok: false, fieldErrors: { siteLocationId: "Location is required" } };
  }
  const derivedSiteId = await deriveSiteId(siteLocationId);
  if (!derivedSiteId) {
    return { ok: false, fieldErrors: { siteLocationId: "Location not found." } };
  }

  const requirements = await loadRequirementsForWeek(siteLocationId, weekStart);
  const slice: RequirementLine[] = input.workAreaId
    ? requirements.filter((r) => r.workAreaId === input.workAreaId)
    : requirements;
  if (slice.length === 0) {
    return { ok: false, message: NO_REQUIREMENTS };
  }

  const [shiftOrder, areaRequirements, rules, prior, workers] =
    await Promise.all([
      loadShiftOrder(siteLocationId),
      loadAreaRequirements(siteLocationId),
      loadEffectiveRules(siteLocationId),
      loadPriorAssignments(siteLocationId, weekDates(weekStart)[0]),
      loadWorkerProfiles(siteLocationId, input.workAreaId),
    ]);

  try {
    await db.transaction(async (tx) => {
      if (input.workAreaId) {
        // Regenerate-slice: open (and lock) the existing weekly draft for
        // the week; without one there is nothing to regenerate.
        const [draft] = await tx
          .select()
          .from(rosterPlan)
          .where(
            and(
              eq(rosterPlan.siteLocationId, siteLocationId),
              eq(rosterPlan.weekStart, weekStart),
              eq(rosterPlan.kind, "weekly"),
              eq(rosterPlan.status, "draft"),
            ),
          )
          .limit(1)
          .for("update");
        if (!draft) throw new ActionAbort({ ok: false, message: NOT_FOUND });

        // The other areas' rows are the "current" side of the workers'
        // merged horizon — the slice replaces ONLY its own area's rows and
        // must respect what the rest of the draft already committed.
        const existing = await tx
          .select({
            workerId: rosterAssignment.workerId,
            date: rosterAssignment.date,
            shiftDefinitionId: rosterAssignment.shiftDefinitionId,
            workAreaId: rosterAssignment.workAreaId,
          })
          .from(rosterAssignment)
          .where(eq(rosterAssignment.planId, draft.id));
        const otherAreaRows: RosterAssignment[] = existing
          .filter((r) => r.workAreaId !== input.workAreaId)
          .map((r) => ({
            workerId: r.workerId,
            date: r.date,
            shiftDefId: r.shiftDefinitionId,
            workAreaId: r.workAreaId,
          }));

        const { assignments } = generateDraft({
          requirements: slice,
          workers,
          shiftOrder,
          areaRequirements,
          priorAssignments: [...prior, ...otherAreaRows],
          rules,
        });

        await tx
          .delete(rosterAssignment)
          .where(
            and(
              eq(rosterAssignment.planId, draft.id),
              eq(rosterAssignment.workAreaId, input.workAreaId),
            ),
          );
        if (assignments.length > 0) {
          await tx.insert(rosterAssignment).values(
            assignments.map((a) =>
              assignmentRow(draft.id, draft.siteId, siteLocationId, a),
            ),
          );
        }
        // Same version, same plan — only the slice's rows and the frozen
        // rule snapshot refresh.
        await tx
          .update(rosterPlan)
          .set({ rulesSnapshot: rules })
          .where(eq(rosterPlan.id, draft.id));

        await recordRosterAudit(tx, {
          actorId: actor.id,
          action: "roster.regenerate",
          siteId: derivedSiteId,
          siteLocationId,
          details: {
            planId: draft.id,
            version: draft.version,
            workAreaId: input.workAreaId,
          },
        });
      } else {
        const { assignments } = generateDraft({
          requirements: slice,
          workers,
          shiftOrder,
          areaRequirements,
          priorAssignments: prior,
          rules,
        });

        const [plan] = await tx
          .insert(rosterPlan)
          .values({
            siteId: derivedSiteId,
            siteLocationId,
            kind: "weekly",
            weekStart,
            requestDate: null,
            rulesSnapshot: rules,
            generatedBy: actor.id,
          })
          .returning({ id: rosterPlan.id, version: rosterPlan.version });
        if (assignments.length > 0) {
          await tx.insert(rosterAssignment).values(
            assignments.map((a) =>
              assignmentRow(plan.id, derivedSiteId, siteLocationId, a),
            ),
          );
        }

        await recordRosterAudit(tx, {
          actorId: actor.id,
          action: "roster.generate",
          siteId: derivedSiteId,
          siteLocationId,
          details: { planId: plan.id, version: plan.version },
        });
      }
    });
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    // The partial unique race (two admins generating at once) reads exactly
    // like the pre-check's refusal.
    if (pgErrorCode(err) === "23505") return { ok: false, message: DRAFT_EXISTS };
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/roster");
  return { ok: true };
}

// Copy-on-edit gate: a published plan is never edited in place — editing
// clones it (version+1, draft, published fields NULL) with its rows and
// returns the new plan id; a draft returns unchanged. One transaction, one
// audit entry (roster.revise).
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

// The plan's rows validated over the merged context: plan rows (the current
// side) + prior published history strictly before the plan's horizon, rules
// from the plan's own snapshot (the editor judges by the rules the draft
// was generated with; publish re-checks against the RESOLVED ones).
async function planViolations(
  siteLocationId: string,
  rules: EffectiveRules,
  rows: RosterAssignment[],
): Promise<Violation[]> {
  const weekStart = mondayOf(rows[0]?.date ?? "1970-01-05");
  const [shiftOrder, areaRequirements, profiles, prior] = await Promise.all([
    loadShiftOrder(siteLocationId),
    loadAreaRequirements(siteLocationId),
    loadWorkerProfiles(siteLocationId),
    loadPriorAssignments(siteLocationId, weekDates(weekStart)[0]),
  ]);
  return validateRoster(
    [...rows, ...prior],
    buildWorkersRecord(profiles),
    rules,
    shiftOrder,
    areaRequirements,
  );
}

export async function setAssignment(
  input: SetAssignmentInput,
): Promise<SetAssignmentResult> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_EDIT_MESSAGE };
  }
  if (!areIds(input.planId, input.workerId) || !isDate(input.date)) {
    return { ok: false, message: NOT_FOUND };
  }

  // Scope rides the PLAN's ownership (an admin owns their location's plans;
  // an ho is refused above; superadmin unbounded).
  const owned = await rosterPlanOwnedByActor(actor, input.planId);
  if (!owned) return { ok: false, message: NOT_FOUND };

  try {
    const planId = await ensureDraftVersion(input.planId, actor.id);

    const result = await db.transaction(async (tx): Promise<SetAssignmentResult> => {
      const [plan] = await tx
        .select()
        .from(rosterPlan)
        .where(eq(rosterPlan.id, planId))
        .limit(1);
      if (!plan) throw new ActionAbort({ ok: false, message: NOT_FOUND });

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
      );

      return { ok: true, data: { violations } };
    });

    revalidatePath("/dashboard/roster");
    return result;
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return { ok: false, message: GENERIC_ERROR };
  }
}

export async function publishRoster(planId: string): Promise<ActionState> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_PUBLISH_MESSAGE };
  }
  if (!areIds(planId)) return { ok: false, message: NOT_FOUND };

  const owned = await rosterPlanOwnedByActor(actor, planId);
  if (!owned) return { ok: false, message: NOT_FOUND };

  const bundle = await loadPlanWithRows(planId);
  if (!bundle) return { ok: false, message: NOT_FOUND };
  const plan = bundle.plan;
  if (plan.status !== "draft") {
    return { ok: false, message: ALREADY_PUBLISHED };
  }

  const siteLocationId = plan.siteLocationId;
  const horizonStart = weekDates(
    plan.kind === "weekly"
      ? (plan.weekStart as string)
      : mondayOf(plan.requestDate as string),
  )[0];
  const rules = await loadEffectiveRules(siteLocationId);
  const [shiftOrder, areaRequirements, prior, profiles, requirements] =
    await Promise.all([
      loadShiftOrder(siteLocationId),
      loadAreaRequirements(siteLocationId),
      loadPriorAssignments(siteLocationId, horizonStart),
      loadWorkerProfiles(siteLocationId),
      plan.kind === "weekly"
        ? loadRequirementsForWeek(siteLocationId, plan.weekStart as string)
        : Promise.resolve([] as RequirementLine[]),
    ]);

  const violations = validateRoster(
    [...bundle.assignments, ...prior],
    buildWorkersRecord(profiles),
    rules,
    shiftOrder,
    areaRequirements,
  );

  // Workers deactivated (or removed) after generation never reach the
  // profiles loader — validateRoster would silently skip their checks.
  // Flag every offending row so a stale draft cannot publish silently.
  const workerIds = [...new Set(bundle.rows.map((r) => r.workerId))];
  if (workerIds.length > 0) {
    const workerRows = await db
      .select({
        id: worker.id,
        employeeId: worker.employeeId,
        isActive: worker.isActive,
        deletedAt: worker.deletedAt,
      })
      .from(worker)
      .where(inArray(worker.id, workerIds));
    const offenderByWorker = new Map(
      workerRows
        .filter((w) => w.deletedAt !== null || !w.isActive)
        .map((w) => [w.id, w]),
    );
    for (const row of bundle.rows) {
      const offender = offenderByWorker.get(row.workerId);
      if (!offender) continue;
      violations.push({
        rule: "C7",
        workerId: row.workerId,
        date: row.date,
        message: `${offender.employeeId} is no longer active`,
      });
    }
  }

  if (violations.length > 0) {
    return { ok: false, message: violationMessage(violations) };
  }

  // Deficits are shown, not blocking (spec §6.3): the count rides the audit.
  const deficits = computeDeficit(requirements, bundle.assignments);

  try {
    await db.transaction(async (tx) => {
      // Guarded write: the draft status rides in the WHERE (plus the
      // fail-closed mutation WHERE for the actor's scope), so a concurrent
      // publish/revision turns this into a 0-row no-op.
      const updated = await tx
        .update(rosterPlan)
        .set({
          status: "published",
          publishedAt: new Date(),
          publishedBy: actor.id,
        })
        .where(
          and(
            rosterPlanMutationWhere(actor, planId),
            eq(rosterPlan.status, "draft"),
          ),
        )
        .returning({ id: rosterPlan.id });
      if (updated.length === 0) {
        throw new ActionAbort({ ok: false, message: RACE_MESSAGE });
      }

      await recordRosterAudit(tx, {
        actorId: actor.id,
        action: "roster.publish",
        siteId: plan.siteId,
        siteLocationId,
        details: {
          planId,
          version: plan.version,
          violationCount: 0,
          deficitCount: deficits.length,
        },
      });
    });
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/roster");
  return { ok: true };
}

export async function suggestReplacementsAction(
  input: SuggestInput,
): Promise<{ ok: true; data: SuggestedCandidate[] } | ActionState> {
  const actor = await requireUser();

  const siteLocationId = effectiveSiteLocationId(actor, input.siteLocationId);
  if (!siteLocationId) {
    return { ok: false, message: "Location is required" };
  }
  if (
    !areIds(input.workAreaId, input.shiftDefId) ||
    !isDate(input.date)
  ) {
    return { ok: false, message: "Invalid suggestion target" };
  }

  const weekStart = mondayOf(input.date);

  // Context = the LATEST published weekly plan of the date's week (a
  // revised plan republishes at a higher version; only its rows count) +
  // the location's prior history.
  const [weeklyPlan] = await db
    .select({ id: rosterPlan.id })
    .from(rosterPlan)
    .where(
      and(
        eq(rosterPlan.siteLocationId, siteLocationId),
        eq(rosterPlan.kind, "weekly"),
        eq(rosterPlan.status, "published"),
        eq(rosterPlan.weekStart, weekStart),
      ),
    )
    .orderBy(desc(rosterPlan.version))
    .limit(1);

  const weeklyRows: RosterAssignment[] = weeklyPlan
    ? (
        await db
          .select({
            workerId: rosterAssignment.workerId,
            date: rosterAssignment.date,
            shiftDefinitionId: rosterAssignment.shiftDefinitionId,
            workAreaId: rosterAssignment.workAreaId,
          })
          .from(rosterAssignment)
          .where(eq(rosterAssignment.planId, weeklyPlan.id))
      ).map((r) => ({
        workerId: r.workerId,
        date: r.date,
        shiftDefId: r.shiftDefinitionId,
        workAreaId: r.workAreaId,
      }))
    : [];

  const [prior, workers, shiftOrder, areaRequirements, rules] =
    await Promise.all([
      loadPriorAssignments(siteLocationId, weekDates(weekStart)[0]),
      loadWorkerProfiles(siteLocationId, input.workAreaId),
      loadShiftOrder(siteLocationId),
      loadAreaRequirements(siteLocationId),
      loadEffectiveRules(siteLocationId),
    ]);

  const data = suggestReplacements(
    {
      workAreaId: input.workAreaId,
      shiftDefId: input.shiftDefId,
      date: input.date,
      headcount: 1,
    },
    weeklyRows,
    prior,
    workers,
    shiftOrder,
    areaRequirements,
    rules,
    5,
  );

  return { ok: true, data };
}

export async function fillDailyRequest(
  input: FillDailyRequestInput,
): Promise<ActionState> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_FILL_MESSAGE };
  }
  const siteLocationId = effectiveSiteLocationId(actor, input.siteLocationId);
  if (!siteLocationId) {
    return { ok: false, fieldErrors: { siteLocationId: "Location is required" } };
  }
  if (
    !areIds(input.requestId, input.workerId, input.workAreaId, input.shiftDefId) ||
    !isDate(input.date)
  ) {
    return { ok: false, message: REQUEST_GONE };
  }

  const weekStart = mondayOf(input.date);

  // A published weekly plan must cover the date's week — the daily fill is
  // an exception to a plan, not a standalone roster.
  const [weekly] = await db
    .select()
    .from(rosterPlan)
    .where(
      and(
        eq(rosterPlan.siteLocationId, siteLocationId),
        eq(rosterPlan.kind, "weekly"),
        eq(rosterPlan.status, "published"),
        eq(rosterPlan.weekStart, weekStart),
      ),
    )
    .limit(1);
  if (!weekly) return { ok: false, message: PUBLISH_FIRST };

  const [request] = await db
    .select({
      id: mpRequest.id,
      siteLocationId: mpRequest.siteLocationId,
    })
    .from(mpRequest)
    .where(eq(mpRequest.id, input.requestId))
    .limit(1);
  if (!request || request.siteLocationId !== siteLocationId) {
    return { ok: false, message: REQUEST_GONE };
  }

  // Candidate worker + referenced area/shift must be live and belong here —
  // the weld FKs check the site/location pair but not liveness.
  const [workerRow] = await db
    .select({ id: worker.id, isActive: worker.isActive })
    .from(worker)
    .where(
      and(
        eq(worker.id, input.workerId),
        eq(worker.siteLocationId, siteLocationId),
        isNull(worker.deletedAt),
      ),
    )
    .limit(1);
  if (!workerRow || !workerRow.isActive) {
    return { ok: false, message: WORKER_UNAVAILABLE };
  }

  const referenceRows = await Promise.all([
    db
      .select({ id: workArea.id })
      .from(workArea)
      .where(
        and(
          eq(workArea.id, input.workAreaId),
          eq(workArea.siteLocationId, siteLocationId),
          isNull(workArea.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: shiftDefinition.id })
      .from(shiftDefinition)
      .where(
        and(
          eq(shiftDefinition.id, input.shiftDefId),
          eq(shiftDefinition.siteLocationId, siteLocationId),
          isNull(shiftDefinition.deletedAt),
        ),
      )
      .limit(1),
  ]);
  if (referenceRows[0].length === 0 || referenceRows[1].length === 0) {
    return { ok: false, message: REFERENCE_GONE };
  }
  if (!referenceRows[0][0].id || !referenceRows[1][0].id) {
    return { ok: false, message: REFERENCE_FK };
  }

  // Admission, not trust: the candidate is validated over the merged week
  // context — the published week's rows, any rows the daily plan already
  // holds, and the prior history. Rejected candidates never reach the write.
  const [rules, shiftOrder, areaRequirements, prior, profiles, weeklyRows, dailyRows] =
    await Promise.all([
      loadEffectiveRules(siteLocationId),
      loadShiftOrder(siteLocationId),
      loadAreaRequirements(siteLocationId),
      loadPriorAssignments(siteLocationId, weekDates(weekStart)[0]),
      loadWorkerProfiles(siteLocationId),
      db
        .select({
          workerId: rosterAssignment.workerId,
          date: rosterAssignment.date,
          shiftDefinitionId: rosterAssignment.shiftDefinitionId,
          workAreaId: rosterAssignment.workAreaId,
        })
        .from(rosterAssignment)
        .where(eq(rosterAssignment.planId, weekly.id)),
      db
        .select({
          workerId: rosterAssignment.workerId,
          date: rosterAssignment.date,
          shiftDefinitionId: rosterAssignment.shiftDefinitionId,
          workAreaId: rosterAssignment.workAreaId,
        })
        .from(rosterAssignment)
        .innerJoin(rosterPlan, eq(rosterAssignment.planId, rosterPlan.id))
        .where(
          and(
            eq(rosterPlan.siteLocationId, siteLocationId),
            eq(rosterPlan.kind, "daily"),
            eq(rosterPlan.requestDate, input.date),
          ),
        ),
    ]);

  const engineShape = (r: {
    workerId: string;
    date: string;
    shiftDefinitionId: string;
    workAreaId: string;
  }): RosterAssignment => ({
    workerId: r.workerId,
    date: r.date,
    shiftDefId: r.shiftDefinitionId,
    workAreaId: r.workAreaId,
  });

  const candidate: RosterAssignment = {
    workerId: input.workerId,
    date: input.date,
    shiftDefId: input.shiftDefId,
    workAreaId: input.workAreaId,
  };
  const violations = validateRoster(
    [...weeklyRows.map(engineShape), ...dailyRows.map(engineShape), ...prior, candidate],
    buildWorkersRecord(profiles),
    rules,
    shiftOrder,
    areaRequirements,
  );
  if (violations.length > 0) {
    return { ok: false, message: violationMessage(violations) };
  }

  try {
    await db.transaction(async (tx) => {
      // The daily plan for the date, any status — reuse it when present
      // (the partial unique keeps exactly one row per date forever).
      const [daily] = await tx
        .select()
        .from(rosterPlan)
        .where(
          and(
            eq(rosterPlan.siteLocationId, siteLocationId),
            eq(rosterPlan.kind, "daily"),
            eq(rosterPlan.requestDate, input.date),
          ),
        )
        .limit(1)
        .for("update");

      const planRow = daily ?? {
        id: (
          await tx
            .insert(rosterPlan)
            .values({
              siteId: weekly.siteId,
              siteLocationId,
              kind: "daily",
              requestDate: input.date,
              weekStart: null,
              rulesSnapshot: rules,
              sourceRequestId: input.requestId,
              generatedBy: actor.id,
            })
            .returning({
              id: rosterPlan.id,
              siteId: rosterPlan.siteId,
            })
        )[0].id,
        siteId: weekly.siteId,
      };

      await tx.insert(rosterAssignment).values(
        assignmentRow(planRow.id, weekly.siteId, siteLocationId, candidate),
      );

      await recordRosterAudit(tx, {
        actorId: actor.id,
        action: "roster.daily_request.fill",
        siteId: weekly.siteId,
        siteLocationId,
        details: {
          requestId: input.requestId,
          workerId: input.workerId,
          date: input.date,
        },
      });
    });
  } catch (err) {
    const code = pgErrorCode(err);
    if (code === "23505") {
      const constraint = pgErrorConstraint(err);
      // Race on the plan slot vs. a duplicate worker-day — both friendly,
      // both leave the earlier row untouched.
      if (constraint === "roster_plan_daily_unique") {
        return { ok: false, message: DAILY_PLAN_RACE };
      }
      return { ok: false, message: ASSIGNMENT_DUPLICATE };
    }
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/roster");
  return { ok: true };
}
