"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { siteLocation } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { requireHO, type SessionUser } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import { fieldErrorsFrom, GENERIC_ERROR } from "@/lib/action-state";
import { resolveRules } from "@/lib/engine/resolve";
import type { RuleKey } from "@/lib/engine/types";
import {
  loadGlobalRows,
  loadLocationRows,
  loadSiteRows,
  upsertRuleRow,
  type RuleScope,
} from "@/lib/rule-config";
import { ruleConfigSchema } from "@/lib/rule-config-validators";

// Maps a driver error to the action result shape (same convention as the
// other dashboard actions). The rule-config upsert has no duplicate-key
// message of its own — a 23505 here is a concurrent upsert race, a 23503 a
// location deleted between check and write — so every driver error falls
// back to the generic message.
function dbResult(err: unknown): ActionState {
  console.error("updateRuleConfig driver error:", err);
  return { ok: false, message: GENERIC_ERROR };
}

// HO scoping (mirror of effectiveSiteId in app/dashboard/locations/
// actions.ts): a ho's effective site is their own binding; a superadmin
// stays unbound. The scope resolution below never lets a ho's write escape
// that site — a ho asking for the global base gets a field error, not a
// silent rewrite, because changing the global base would reach other sites.
function effectiveSiteId(actor: SessionUser): string | null {
  return actor.role === "superadmin" ? null : (actor.siteId ?? null);
}

// The C5 value in force where a write lands, so the C6 <= C5 sanity check
// judges against the rules that will actually apply at that scope: the
// most-specific row wins, then the built-in default (60).
async function effectiveC5(scope: RuleScope): Promise<number> {
  const [globalRows, siteRows, locationRows] = await Promise.all([
    loadGlobalRows(),
    scope.kind === "global" ? [] : loadSiteRows(scope.siteId),
    scope.kind === "location"
      ? loadLocationRows(scope.siteId, scope.siteLocationId)
      : [],
  ]);
  return resolveRules(globalRows, siteRows, locationRows).c5.value;
}

// Resolves the write's target scope from the actor's binding. Returns an
// ActionState error when the requested scope is not one the actor may
// write: a ho is pinned to their site, a superadmin answers the global
// base (and any named location, with its parent site derived below).
async function resolveScope(
  actor: SessionUser,
  input: { scope: "global" | "site" | "location"; siteLocationId?: string },
): Promise<{ ok: true; scope: RuleScope } | { ok: false; error: ActionState }> {
  if (input.scope === "global") {
    if (actor.role !== "superadmin") {
      return {
        ok: false,
        error: {
          ok: false,
          fieldErrors: { scope: "HO accounts change their own site's rules." },
        },
      };
    }
    return { ok: true, scope: { kind: "global" } };
  }

  if (input.scope === "site") {
    const siteId = effectiveSiteId(actor);
    // Null-bound ho (the brief's mandated refusal) — and a superadmin site
    // write, which cannot name its target: the input shape carries no site
    // selector, only a siteLocationId for the location scope.
    if (!siteId) {
      return {
        ok: false,
        error: { ok: false, fieldErrors: { siteId: "Site is required." } },
      };
    }
    return { ok: true, scope: { kind: "site", siteId } };
  }

  // Location scope: the id is validated (a uuid string) BEFORE the
  // ownership query — a malformed one must answer a field error, not let
  // the DB throw 22P02 out of the unguarded select (parse-first is the
  // mandated convention chain).
  if (!input.siteLocationId) {
    return {
      ok: false,
      error: {
        ok: false,
        fieldErrors: { siteLocationId: "Location is required." },
      },
    };
  }
  if (!z.uuid().safeParse(input.siteLocationId).success) {
    return {
      ok: false,
      error: {
        ok: false,
        fieldErrors: {
          siteLocationId: "Invalid location id.",
        },
      },
    };
  }
  // The location must exist, be live, and belong to the actor's effective
  // site; the scope's siteId is derived from the row's actual parent, so
  // the (siteId, siteLocationId) pair can never disagree — inconsistent
  // pairs are unwritable through this action.
  const [location] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(
      and(
        eq(siteLocation.id, input.siteLocationId),
        isNull(siteLocation.deletedAt),
      ),
    )
    .limit(1);
  if (!location) {
    return { ok: false, error: { ok: false, message: "Location not found." } };
  }
  const actorSite = effectiveSiteId(actor);
  if (actorSite !== null && location.siteId !== actorSite) {
    // Foreign location — answer "not found." like the location actions do,
    // never leaking that the row exists outside one's site.
    return { ok: false, error: { ok: false, message: "Location not found." } };
  }
  return {
    ok: true,
    scope: {
      kind: "location",
      siteId: location.siteId,
      siteLocationId: input.siteLocationId,
    },
  };
}

export async function updateRuleConfig(input: {
  ruleKey: RuleKey;
  scope: "global" | "site" | "location";
  siteLocationId?: string;
  intValue?: number | null;
  boolValue?: boolean | null;
}): Promise<ActionState> {
  const actor = await requireHO();

  const scopeResult = await resolveScope(actor, input);
  if (!scopeResult.ok) return scopeResult.error;

  // Parse against the C5 effective at the resolved scope, so the C6 <= C5
  // sanity refine judges the values that will actually apply there.
  const parsed = ruleConfigSchema(await effectiveC5(scopeResult.scope)).safeParse({
    ruleKey: input.ruleKey,
    scope: input.scope,
    siteLocationId: input.siteLocationId,
    intValue: input.intValue ?? null,
    boolValue: input.boolValue ?? null,
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    await upsertRuleRow({
      ruleKey: parsed.data.ruleKey,
      scope: scopeResult.scope,
      intValue: parsed.data.intValue ?? null,
      boolValue: parsed.data.boolValue ?? null,
      actorId: actor.id,
    });
  } catch (err) {
    return dbResult(err);
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
