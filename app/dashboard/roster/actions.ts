"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import {
  mpRequest,
  mpRequestLine,
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
import { withoutFulfilledDailyFills } from "@/lib/engine/coverage";
import { computeDeficit } from "@/lib/engine/deficit";
import { generateDraft } from "@/lib/engine/generate";
import type { RequirementLine, SuggestedCandidate } from "@/lib/engine/generate";
import { suggestReplacements } from "@/lib/engine/suggest";
import {
  buildWorkersRecord,
  crossPlanDayConflicts,
  validateRoster,
} from "@/lib/engine/validate";
import type { Violation } from "@/lib/engine/validate";
import type { RosterAssignment } from "@/types/engine";
import { loadEffectiveRules } from "@/lib/rule-config";
import {
  latestPublishedWeeklyPlan,
  loadAreaNames,
  loadAreaRequirements,
  loadDailyAssignmentsInRange,
  loadPlanWithRows,
  loadPriorAssignments,
  loadRequirementsForWeek,
  loadShiftLabels,
  loadShiftOrder,
  loadWorkerProfiles,
} from "@/lib/roster-data";
import {
  rosterPlanMutationWhere,
  rosterPlanOwnedByActor,
} from "@/lib/roster-scope";
import { recordMpRequestAudit } from "@/lib/mp-request-audit";
import { recordRosterAudit } from "@/lib/roster-audit";
import {
  ActionAbort,
  applyAssignmentEdit,
  ensureDraftVersion,
  planViolations,
  splitViolationsByHorizon,
  type SetAssignmentInput,
  type SetAssignmentResult,
} from "@/lib/roster-plan-mutations";

// Roster actions (roster-engine task 6): the persistence + state machine
// layer over roster_plan/roster_assignment. Every action re-checks the
// session, derives its scope server-side (an admin is pinned to their own
// site_location; an ho is read-only on rosters and refused outright), and
// writes its audit row in the SAME transaction as the data (pattern:
// app/dashboard/requests/actions.ts). Dates are "YYYY-MM-DD" strings.

// The revise flow's outcome, typed so the client shell's ReviseOutcome
// stays assignable.
export type RevisePlanResult =
  | { ok: true; draftPlanId: string }
  | { ok: false; message: string };

export interface GenerateRosterInput {
  weekStart: string;
  workAreaId?: string;
  // Superadmin-only affordance (the dialog's pick); an admin's binding
  // overrides it, exactly like the request actions.
  siteLocationId?: string;
}

export type { SetAssignmentInput, SetAssignmentResult };

export interface FillDailyRequestInput {
  requestId: string;
  workAreaId: string;
  shiftDefId: string;
  date: string;
  positionId: string;
  workerId: string;
  siteLocationId?: string;
}

export interface SuggestInput {
  workAreaId: string;
  shiftDefId: string;
  date: string;
  positionId: string;
  siteLocationId?: string;
}

// Messages pinned by the plan — the tests assert them verbatim.
const HO_GENERATE_MESSAGE = "Only admins generate rosters";
const HO_EDIT_MESSAGE = "Only admins edit rosters";
const HO_PUBLISH_MESSAGE = "Only admins publish rosters";
const HO_FILL_MESSAGE = "Only admins fill daily requests";
const HO_REVISE_MESSAGE = "Only admins revise rosters";
const HO_DISCARD_MESSAGE = "Only admins discard drafts";
const ONLY_WEEKLY_DISCARD = "Only weekly rosters can be discarded.";
const ONLY_DRAFT_DISCARD = "Only drafts can be discarded.";
const NO_REQUIREMENTS = "No approved requests cover this week.";
const DRAFT_EXISTS = "Draft already exists";
const NOT_FOUND = "Roster not found.";
const ALREADY_PUBLISHED = "Roster is already published";
const RACE_MESSAGE = "Roster state changed, reload";
const REQUEST_GONE = "Daily request not found.";
const WORKER_UNAVAILABLE = "Worker is not available for this roster";
const REFERENCE_FK =
  "Selected work area or shift must belong to this request's location";
const REFERENCE_GONE = "Selected work area or shift no longer exists";
const ASSIGNMENT_DUPLICATE = "That worker already has a shift on this date";
const DAILY_PLAN_RACE = "A daily plan already exists for this date";
const POSITION_MISMATCH = "Worker does not hold the requested position";

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

  const week = weekDates(weekStart);
  const [shiftOrder, areaRequirements, rules, history, dailyRows, workers] =
    await Promise.all([
      loadShiftOrder(siteLocationId),
      loadAreaRequirements(siteLocationId),
      loadEffectiveRules(siteLocationId),
      loadPriorAssignments(siteLocationId, week[0]),
      loadDailyAssignmentsInRange(siteLocationId, week[0], week[6]),
      loadWorkerProfiles(siteLocationId, input.workAreaId),
    ]);
  // The week's daily fills are fixed history for the generator: a worker
  // already filled for a date is never drafted onto it again, and the fills
  // count toward C1/C3/C4 like any other assigned day.
  const prior = [...history, ...dailyRows];

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
  revalidatePath("/dashboard/requests");
  return { ok: true };
}

// Guarded revise entry for the UI flow (a thin, session-checked wrapper —
// the raw ensureDraftVersion primitive stays in the plain mutations module,
// never network-reachable): the actor is resolved server-side and names the
// audit entry AND the clone's generated_by — the clicking admin.
export async function revisePlan(
  planId: string,
): Promise<RevisePlanResult> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_REVISE_MESSAGE };
  }
  if (!areIds(planId)) return { ok: false, message: NOT_FOUND };

  const owned = await rosterPlanOwnedByActor(actor, planId);
  if (!owned) return { ok: false, message: NOT_FOUND };

  try {
    return { ok: true, draftPlanId: await ensureDraftVersion(planId, actor.id) };
  } catch (err) {
    if (err instanceof ActionAbort) {
      return { ok: false, message: err.state.message ?? GENERIC_ERROR };
    }
    return { ok: false, message: GENERIC_ERROR };
  }
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

    const result = await applyAssignmentEdit(planId, input);

    if (result.ok) revalidatePath("/dashboard/roster");
    return result;
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return { ok: false, message: GENERIC_ERROR };
  }
}

// The write half of setAssignment lives in lib/roster-plan-mutations.ts
// (applyAssignmentEdit); tests drive it from there directly — in this
// "use server" module it would be a network-reachable endpoint.

// Discarding removes the draft plan row; its assignments go with it through
// the ON DELETE CASCADE on roster_assignment.plan_id. Published versions and
// daily plans are never deleted (a daily plan is born "draft", so the kind
// check must run before the status check), and mp_request is untouched.
export async function discardDraft(planId: string): Promise<ActionState> {
  const actor = await requireUser();

  if (actor.role === "ho") {
    return { ok: false, message: HO_DISCARD_MESSAGE };
  }
  if (!areIds(planId)) return { ok: false, message: NOT_FOUND };

  const owned = await rosterPlanOwnedByActor(actor, planId);
  if (!owned) return { ok: false, message: NOT_FOUND };

  try {
    await db.transaction(async (tx) => {
      // Row lock: a concurrent publish/revise of this plan waits for us (or
      // we for it) instead of interleaving between the read and the delete.
      const [plan] = await tx
        .select()
        .from(rosterPlan)
        .where(eq(rosterPlan.id, planId))
        .limit(1)
        .for("update");
      if (!plan) throw new ActionAbort({ ok: false, message: NOT_FOUND });
      if (plan.kind !== "weekly") {
        throw new ActionAbort({ ok: false, message: ONLY_WEEKLY_DISCARD });
      }
      if (plan.status !== "draft") {
        throw new ActionAbort({ ok: false, message: ONLY_DRAFT_DISCARD });
      }

      const assignmentCount = await tx.$count(
        rosterAssignment,
        eq(rosterAssignment.planId, planId),
      );

      // The draft status rides in the DELETE itself, so a plan that was
      // published after the read can never be removed.
      const deleted = await tx
        .delete(rosterPlan)
        .where(
          and(
            rosterPlanMutationWhere(actor, planId),
            eq(rosterPlan.status, "draft"),
          ),
        )
        .returning({ id: rosterPlan.id });
      if (deleted.length === 0) {
        throw new ActionAbort({ ok: false, message: RACE_MESSAGE });
      }

      await recordRosterAudit(tx, {
        actorId: actor.id,
        action: "roster.discard",
        siteId: plan.siteId,
        siteLocationId: plan.siteLocationId,
        details: {
          planId,
          version: plan.version,
          weekStart: plan.weekStart,
          assignmentCount,
        },
      });
    });
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/roster");
  revalidatePath("/dashboard/requests");
  return { ok: true };
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
  const rules = await loadEffectiveRules(siteLocationId);
  // The same merged context the editor and the page's publish gate use (plan
  // rows + the week's daily fills + prior history), judged by the freshly
  // resolved rules, so publish and the editor cannot disagree.
  const [violations, requirements] = await Promise.all([
    planViolations(siteLocationId, rules, bundle.assignments, db, plan.kind),
    plan.kind === "weekly"
      ? loadRequirementsForWeek(siteLocationId, plan.weekStart as string)
      : Promise.resolve([] as RequirementLine[]),
  ]);

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

  const { blocking, historical } = splitViolationsByHorizon(violations, plan);

  if (blocking.length > 0) {
    return { ok: false, message: violationMessage(blocking) };
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

      // Only after the guarded plan update succeeded, so a refused or raced
      // publish leaves the requests untouched. A weekly publish fulfils every
      // approved weekly request of its location and week (a late request
      // approved after an earlier publish is picked up by the revision's).
      if (plan.kind === "weekly") {
        const fulfilled = await tx
          .update(mpRequest)
          .set({ status: "fulfilled", updatedAt: new Date() })
          .where(
            and(
              eq(mpRequest.siteLocationId, siteLocationId),
              eq(mpRequest.type, "weekly"),
              eq(mpRequest.weekStart, plan.weekStart as string),
              eq(mpRequest.status, "approved"),
            ),
          )
          .returning({
            id: mpRequest.id,
            siteId: mpRequest.siteId,
            siteLocationId: mpRequest.siteLocationId,
          });
        for (const request of fulfilled) {
          await recordMpRequestAudit(tx, {
            actorId: actor.id,
            action: "mp_request.status_change",
            siteId: request.siteId,
            siteLocationId: request.siteLocationId,
            details: {
              requestId: request.id,
              type: "weekly",
              oldValue: "approved",
              newValue: "fulfilled",
              auto: true,
            },
          });
        }
      }
    });
  } catch (err) {
    if (err instanceof ActionAbort) return err.state;
    return { ok: false, message: GENERIC_ERROR };
  }

  revalidatePath("/dashboard/roster");
  revalidatePath("/dashboard/requests");
  // Historical (prior-plan) warnings ride a successful result so the
  // tightening that does not block is still never silent.
  if (historical.length > 0) {
    return {
      ok: true,
      message: `Prior-plan warnings (not blocking): ${violationMessage(historical)}`,
    };
  }
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
    !areIds(
      input.workAreaId,
      input.shiftDefId,
      input.positionId,
    ) ||
    !isDate(input.date)
  ) {
    return { ok: false, message: "Invalid suggestion target" };
  }

  // The candidates leak worker identities, so an ho's read grant stays
  // within their OWN SITE (spec §5): derive the pick's site and fail closed
  // on anything outside it. Superadmin is unbounded; an admin is pinned
  // above (their own location).
  if (actor.role === "ho") {
    const siteId = await deriveSiteId(siteLocationId);
    if (!siteId || siteId !== actor.siteId) {
      return { ok: false, message: "Suggestions are limited to your own site" };
    }
  }

  const weekStart = mondayOf(input.date);

  // Context = the LATEST published weekly plan of the date's week (a
  // revised plan republishes at a higher version; only its rows count) +
  // the location's prior history. The weekly-plan pick and the whole-week
  // daily rows below are the SAME ones fillDailyRequest validates against, so
  // a suggestion and the fill that follows it cannot disagree.
  const weeklyPlan = await latestPublishedWeeklyPlan(siteLocationId, weekStart);

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

  // Daily fills of the week sit on top of the published plan; leaving them
  // out would suggest a worker already filled today and undercount the week.
  const week = weekDates(weekStart);
  const [prior, dailyRows, workers, shiftOrder, areaRequirements, rules] =
    await Promise.all([
      loadPriorAssignments(siteLocationId, week[0]),
      loadDailyAssignmentsInRange(siteLocationId, week[0], week[6]),
      loadWorkerProfiles(siteLocationId, input.workAreaId),
      loadShiftOrder(siteLocationId),
      loadAreaRequirements(siteLocationId),
      loadEffectiveRules(siteLocationId),
    ]);

  const data = suggestReplacements(
    {
      workAreaId: input.workAreaId,
      shiftDefId: input.shiftDefId,
      positionId: input.positionId,
      date: input.date,
      headcount: 1,
    },
    [...weeklyRows, ...dailyRows],
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
    !areIds(
      input.requestId,
      input.workerId,
      input.workAreaId,
      input.shiftDefId,
      input.positionId,
    ) ||
    !isDate(input.date)
  ) {
    return { ok: false, message: REQUEST_GONE };
  }

  const weekStart = mondayOf(input.date);

  // A published weekly plan is context when the week has one, never a
  // prerequisite: a daily request can be filled before (or without) a weekly
  // roster. The shared helper picks the LATEST published version (same one
  // suggestReplacementsAction reads — the two cannot disagree about which
  // week's rows are operative). A draft weekly is invisible to the fill.
  const weekly = await latestPublishedWeeklyPlan(siteLocationId, weekStart);
  const siteId = await deriveSiteId(siteLocationId);
  if (!siteId) return { ok: false, message: REQUEST_GONE };

  const [request] = await db
    .select({
      id: mpRequest.id,
      siteLocationId: mpRequest.siteLocationId,
      type: mpRequest.type,
      status: mpRequest.status,
    })
    .from(mpRequest)
    .where(eq(mpRequest.id, input.requestId))
    .limit(1);
  if (
    !request ||
    request.siteLocationId !== siteLocationId ||
    request.type !== "daily" ||
    request.status !== "open"
  ) {
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
  // context — the published week's rows (when there is one), every daily-plan row of that week
  // (the same range suggestReplacementsAction reads, so an earlier fill on a
  // nearby day counts toward C1/C3/C4), and the prior history. Rejected
  // candidates never reach the write.
  const week = weekDates(weekStart);
  const [
    rules,
    shiftOrder,
    shiftLabels,
    areaNames,
    areaRequirements,
    prior,
    profiles,
    weeklyRows,
    dailyRows,
  ] = await Promise.all([
    loadEffectiveRules(siteLocationId),
    loadShiftOrder(siteLocationId),
    loadShiftLabels(siteLocationId),
    loadAreaNames(siteLocationId),
    loadAreaRequirements(siteLocationId),
    loadPriorAssignments(siteLocationId, week[0]),
    loadWorkerProfiles(siteLocationId),
    weekly
      ? db
          .select({
            workerId: rosterAssignment.workerId,
            date: rosterAssignment.date,
            shiftDefinitionId: rosterAssignment.shiftDefinitionId,
            workAreaId: rosterAssignment.workAreaId,
          })
          .from(rosterAssignment)
          .where(eq(rosterAssignment.planId, weekly.id))
      : Promise.resolve([]),
    loadDailyAssignmentsInRange(siteLocationId, week[0], week[6]),
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

  // The fill is position-aware (#141): the candidate must hold the exact
  // position the line demands — the profiles loader emits one entry per
  // worker×area pair with the worker's position set.
  const profile = profiles.find((p) => p.id === input.workerId);
  if (!profile || !profile.positionIds.includes(input.positionId)) {
    return { ok: false, message: POSITION_MISMATCH };
  }

  const candidate: RosterAssignment = {
    workerId: input.workerId,
    date: input.date,
    shiftDefId: input.shiftDefId,
    workAreaId: input.workAreaId,
  };
  // One shift per worker-day across plans: the same worker on the same date
  // in the published weekly would otherwise be accepted as two work days.
  const conflicts = crossPlanDayConflicts(
    [candidate],
    weeklyRows.map(engineShape),
    (id) => profiles.find((p) => p.id === id)?.employeeId ?? id,
  );
  if (conflicts.length > 0) {
    return { ok: false, message: violationMessage(conflicts) };
  }

  const violations = validateRoster(
    [...weeklyRows.map(engineShape), ...dailyRows, ...prior, candidate],
    buildWorkersRecord(profiles),
    rules,
    shiftOrder,
    areaRequirements,
    shiftLabels,
    areaNames,
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
              siteId: siteId,
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
        siteId: siteId,
      };

      await tx.insert(rosterAssignment).values(
        assignmentRow(planRow.id, siteId, siteLocationId, candidate),
      );

      await recordRosterAudit(tx, {
        actorId: actor.id,
        action: "roster.daily_request.fill",
        siteId: siteId,
        siteLocationId,
        details: {
          requestId: input.requestId,
          workerId: input.workerId,
          date: input.date,
          positionId: input.positionId,
        },
      });

      // A daily request has no approval step: it is fulfilled the moment
      // every one of its lines has its full headcount. Assignments carry no
      // position, so the check is per (area, shift, date).
      const lineRows = await tx
        .select({
          workAreaId: mpRequestLine.workAreaId,
          shiftDefId: mpRequestLine.shiftDefinitionId,
          positionId: mpRequestLine.positionId,
          date: mpRequestLine.date,
          headcount: mpRequestLine.headcount,
        })
        .from(mpRequestLine)
        .where(eq(mpRequestLine.requestId, input.requestId));
      const filledRows = await tx
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
        );
      // The date's daily plan also holds the fills of the location's
      // earlier daily requests that are already fulfilled (a fulfilled
      // request frees the date for a new one). Those fills are discounted
      // first, as the roster page does, so they never count toward this one.
      const fulfilledLines = await tx
        .select({
          workAreaId: mpRequestLine.workAreaId,
          shiftDefId: mpRequestLine.shiftDefinitionId,
          date: mpRequestLine.date,
          headcount: mpRequestLine.headcount,
        })
        .from(mpRequestLine)
        .innerJoin(mpRequest, eq(mpRequestLine.requestId, mpRequest.id))
        .where(
          and(
            eq(mpRequest.type, "daily"),
            eq(mpRequest.status, "fulfilled"),
            eq(mpRequest.siteLocationId, siteLocationId),
            ne(mpRequest.id, input.requestId),
            eq(mpRequestLine.date, input.date),
          ),
        );
      const remaining = computeDeficit(
        lineRows,
        withoutFulfilledDailyFills(filledRows.map(engineShape), fulfilledLines),
      );
      if (remaining.length === 0) {
        const fulfilled = await tx
          .update(mpRequest)
          .set({ status: "fulfilled", updatedAt: new Date() })
          .where(
            and(
              eq(mpRequest.id, input.requestId),
              eq(mpRequest.status, "open"),
            ),
          )
          .returning({ id: mpRequest.id });
        if (fulfilled.length > 0) {
          await recordMpRequestAudit(tx, {
            actorId: actor.id,
            action: "mp_request.status_change",
            siteId: siteId,
            siteLocationId,
            details: {
              requestId: input.requestId,
              type: "daily",
              oldValue: "open",
              newValue: "fulfilled",
              auto: true,
            },
          });
        }
      }
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
  revalidatePath("/dashboard/requests");
  return { ok: true };
}
