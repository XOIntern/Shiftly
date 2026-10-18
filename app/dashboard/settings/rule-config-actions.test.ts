import "dotenv/config";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { and, eq, inArray, isNull, like } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  auditLog,
  rosterRuleConfig,
  site,
  siteLocation,
  user,
} from "@/drizzle/schema";
import type { SessionUser } from "@/lib/session";

// The rule-config action resolves its actor through requireHO — swapped for
// a stub that mirrors the real gate (superadmin and ho pass; admin is
// redirected by throwing) so the real server action runs against the test
// database without a Next request context. The admin-rejection test pins
// that the redirect THROW propagates out of the action — it must never be
// caught into a 200-with-error ActionState. The mock swaps the WHOLE module
// across bun's single test process, so every export other suites may
// resolve must exist here.
class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect: ${url}`);
  }
}

let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => {
    if (actor.role !== "ho" && actor.role !== "superadmin") {
      throw new Redirected("/dashboard");
    }
    return actor;
  },
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test — revalidation is a no-op stub.
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const mkEmail = (id: string) => `t5-rules-${id}@shiftly.test`;

// Self-healing sweep (test hygiene): the per-test finally blocks below
// clean up on assertion failures, but a killed run (SIGKILL/timeout) skips
// them — leaked fixtures then crowd the shared dev DB's users list and can
// break other suites' page-based tests. Before the suite runs, delete any
// rows left over from earlier interrupted runs, matched ONLY by this
// suite's fingerprints (site-name/email prefixes, the seeded location
// name) — never a broad unfiltered delete. Child-first against the FKs:
// audits (restrict user+site deletes) → config rows → users (siteId FK
// restricts the site delete) → locations → sites.
async function sweepLeftoverFixtures(): Promise<void> {
  const leakedSites = await db
    .select({ id: site.id })
    .from(site)
    .where(like(site.name, "t5-rules-site-%"));
  const leakedSiteIds = leakedSites.map((s) => s.id);
  const leakedUsers = await db
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, "t5-rules-%"));
  const leakedUserIds = leakedUsers.map((u) => u.id);

  // Every audit this suite writes carries a leaked actor; the site predicate
  // is belt-and-braces for actor rows that were themselves already swept.
  if (leakedUserIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.actorId, leakedUserIds));
  }
  if (leakedSiteIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.siteId, leakedSiteIds));
    // Location-level config rows carry their parent site's id (CHECK weld),
    // so siteId alone targets site- and location-scoped rows alike.
    await db
      .delete(rosterRuleConfig)
      .where(inArray(rosterRuleConfig.siteId, leakedSiteIds));
  }
  // A global-scoped C5 row carries no siteId, so the site-keyed sweep above
  // cannot see it. This suite is the only writer of global C5 rows through
  // the action and only ever writes 3–5, so the value predicate is this
  // suite's fingerprint — a dev-configured global C5 outside that range
  // survives. A crash between a refused write's guards (RED state) or mid
  // accepted-write cleanup is what this block cleans up.
  await db
    .delete(rosterRuleConfig)
    .where(
      and(
        eq(rosterRuleConfig.ruleKey, "C5"),
        inArray(rosterRuleConfig.intValue, [3, 4, 5]),
        isNull(rosterRuleConfig.siteId),
        isNull(rosterRuleConfig.siteLocationId),
      ),
    );

  if (leakedUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, leakedUserIds));
  }

  if (leakedSiteIds.length > 0) {
    await db
      .delete(siteLocation)
      .where(
        and(
          inArray(siteLocation.siteId, leakedSiteIds),
          eq(siteLocation.name, "T5 Rule Loc"),
        ),
      );
    await db.delete(site).where(inArray(site.id, leakedSiteIds));
  }
}

beforeAll(async () => {
  await sweepLeftoverFixtures();
});

async function seedUser(
  role: SessionUser["role"],
  siteId: string | null,
): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: "T5 Rule Actor",
    email: mkEmail(id),
    emailVerified: true,
    role,
    siteId,
  });
  return id;
}

async function seedSite(): Promise<string> {
  const id = randomUUID();
  await db.insert(site).values({ id, name: `t5-rules-site-${id}` });
  return id;
}

async function seedLocation(siteId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(siteLocation).values({ id, siteId, name: "T5 Rule Loc" });
  return id;
}

async function auditCountFor(actorId: string): Promise<number> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.actorId, actorId));
  return rows.length;
}

// Child-first cleanup: audits (actor restrict) → config rows (site/
// location restrict) → the actor user (site FK restrict) → locations →
// sites.
async function cleanup(actorId: string, siteIds: string[]) {
  await db.delete(auditLog).where(eq(auditLog.actorId, actorId));
  for (const siteId of siteIds) {
    await db
      .delete(rosterRuleConfig)
      .where(eq(rosterRuleConfig.siteId, siteId));
  }
  await db.delete(user).where(eq(user.id, actorId));
  for (const siteId of siteIds) {
    await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
    await db.delete(site).where(eq(site.id, siteId));
  }
}

// Soft-deletes or overwrites a config row: deletedAt set frees the scope,
// matching the partial unique indexes' predicate.
async function seedRuleRow(input: {
  ruleKey: "C5" | "C6";
  siteId?: string;
  siteLocationId?: string;
  intValue: number | null;
  deleted?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(rosterRuleConfig).values({
    id,
    ruleKey: input.ruleKey,
    siteId: input.siteId ?? null,
    siteLocationId: input.siteLocationId ?? null,
    intValue: input.intValue,
    deletedAt: input.deleted ? new Date() : null,
  });
  return id;
}

// Global rows carry no siteId, so cleanup() (which deletes by siteId) cannot
// see them. Snapshot the live global row ids for a rule key before a test
// writes one, then sweep only the ids that appeared since.
async function snapshotGlobalRowIds(ruleKey: "C5"): Promise<string[]> {
  const rows = await db
    .select({ id: rosterRuleConfig.id })
    .from(rosterRuleConfig)
    .where(
      and(
        eq(rosterRuleConfig.ruleKey, ruleKey),
        isNull(rosterRuleConfig.siteId),
        isNull(rosterRuleConfig.siteLocationId),
      ),
    );
  return rows.map((r) => r.id);
}

async function deleteNewGlobalRows(
  before: string[],
  ruleKey: "C5",
): Promise<void> {
  const rows = await db
    .select({ id: rosterRuleConfig.id })
    .from(rosterRuleConfig)
    .where(
      and(
        eq(rosterRuleConfig.ruleKey, ruleKey),
        isNull(rosterRuleConfig.siteId),
        isNull(rosterRuleConfig.siteLocationId),
      ),
    );
  const fresh = rows.map((r) => r.id).filter((id) => !before.includes(id));
  if (fresh.length > 0) {
    await db
      .delete(rosterRuleConfig)
      .where(inArray(rosterRuleConfig.id, fresh));
  }
}

describe("updateRuleConfig C5 descendant guard (issue #55)", () => {
  test("refuses a global C5 write below a site's live C6, naming the site, with zero audits", async () => {
    const siteA = await seedSite();
    const c6RowId = await seedRuleRow({
      ruleKey: "C6",
      siteId: siteA,
      intValue: 5,
    });
    const superId = await seedUser("superadmin", null);

    try {
      actor = {
        id: superId,
        name: "T5 Super",
        email: mkEmail(superId),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C5",
        scope: "global",
        intValue: 3,
      });

      expect(result.ok).toBe(false);
      const message = result.fieldErrors?.intValue ?? "";
      expect(message).toContain(`t5-rules-site-${siteA}`);
      expect(await auditCountFor(superId)).toBe(0);

      // The offending C6 row is untouched; no global C5 row was written.
      const c6Rows = await db
        .select({ intValue: rosterRuleConfig.intValue })
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.id, c6RowId));
      expect(c6Rows).toEqual([{ intValue: 5 }]);
      const globals = await db
        .select({ id: rosterRuleConfig.id })
        .from(rosterRuleConfig)
        .where(
          and(
            eq(rosterRuleConfig.ruleKey, "C5"),
            isNull(rosterRuleConfig.siteId),
            isNull(rosterRuleConfig.siteLocationId),
          ),
        );
      expect(globals).toEqual([]);
    } finally {
      await cleanup(superId, [siteA]);
    }
  });

  test("refuses a site C5 write below one of its locations' live C6, naming the location", async () => {
    const siteA = await seedSite();
    const locA = await seedLocation(siteA);
    await seedRuleRow({
      ruleKey: "C6",
      siteId: siteA,
      siteLocationId: locA,
      intValue: 4,
    });
    const hoId = await seedUser("ho", siteA);

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C5",
        scope: "site",
        intValue: 2,
      });

      expect(result.ok).toBe(false);
      const message = result.fieldErrors?.intValue ?? "";
      expect(message).toContain("T5 Rule Loc");
      expect(await auditCountFor(hoId)).toBe(0);
    } finally {
      await cleanup(hoId, [siteA]);
    }
  });

  test("a refused global C5 write names EVERY offending site, not just the first", async () => {
    const siteA = await seedSite();
    const siteB = await seedSite();
    await seedRuleRow({ ruleKey: "C6", siteId: siteA, intValue: 5 });
    await seedRuleRow({ ruleKey: "C6", siteId: siteB, intValue: 4 });
    const superId = await seedUser("superadmin", null);

    try {
      actor = {
        id: superId,
        name: "T5 Super",
        email: mkEmail(superId),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C5",
        scope: "global",
        intValue: 3,
      });

      expect(result.ok).toBe(false);
      const message = result.fieldErrors?.intValue ?? "";
      expect(message).toContain(`t5-rules-site-${siteA}`);
      expect(message).toContain(`t5-rules-site-${siteB}`);
      expect(await auditCountFor(superId)).toBe(0);
    } finally {
      await cleanup(superId, [siteA, siteB]);
    }
  });

  test("accepts a global C5 write equal to the highest descendant C6, with exactly one audit row", async () => {
    const siteA = await seedSite();
    await seedRuleRow({ ruleKey: "C6", siteId: siteA, intValue: 4 });
    const superId = await seedUser("superadmin", null);
    const globalC5Before = await snapshotGlobalRowIds("C5");

    try {
      actor = {
        id: superId,
        name: "T5 Super",
        email: mkEmail(superId),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C5",
        scope: "global",
        intValue: 4,
      });

      expect(result.ok).toBe(true);
      expect(await auditCountFor(superId)).toBe(1);
    } finally {
      await deleteNewGlobalRows(globalC5Before, "C5");
      await cleanup(superId, [siteA]);
    }
  });

  test("ignores value-less and soft-deleted C6 rows when guarding a global C5 write", async () => {
    const siteA = await seedSite();
    await seedRuleRow({ ruleKey: "C6", siteId: siteA, intValue: null });
    await seedRuleRow({
      ruleKey: "C6",
      siteId: siteA,
      intValue: 9,
      deleted: true,
    });
    const superId = await seedUser("superadmin", null);
    const globalC5Before = await snapshotGlobalRowIds("C5");

    try {
      actor = {
        id: superId,
        name: "T5 Super",
        email: mkEmail(superId),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C5",
        scope: "global",
        intValue: 3,
      });

      expect(result.ok).toBe(true);
      expect(await auditCountFor(superId)).toBe(1);
    } finally {
      await deleteNewGlobalRows(globalC5Before, "C5");
      await cleanup(superId, [siteA]);
    }
  });

  test("ignores C6 rows under a soft-deleted site when guarding a global C5 write", async () => {
    const siteA = await seedSite();
    await seedRuleRow({ ruleKey: "C6", siteId: siteA, intValue: 5 });
    // The site-delete flow soft-deletes while leaving its live config rows
    // in place — a stranded row under a deleted site must not dead-end
    // every future global C5 lower behind an unfixable refusal.
    await db
      .update(site)
      .set({ deletedAt: new Date() })
      .where(eq(site.id, siteA));
    const superId = await seedUser("superadmin", null);
    const globalC5Before = await snapshotGlobalRowIds("C5");

    try {
      actor = {
        id: superId,
        name: "T5 Super",
        email: mkEmail(superId),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C5",
        scope: "global",
        intValue: 3,
      });

      expect(result.ok).toBe(true);
      expect(await auditCountFor(superId)).toBe(1);
    } finally {
      await deleteNewGlobalRows(globalC5Before, "C5");
      await cleanup(superId, [siteA]);
    }
  });

  test("does not guard a location-level C5 write against same-site C6 rows", async () => {
    const siteA = await seedSite();
    const locA = await seedLocation(siteA);
    await seedRuleRow({ ruleKey: "C6", siteId: siteA, intValue: 9 });
    const hoId = await seedUser("ho", siteA);

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C5",
        scope: "location",
        siteLocationId: locA,
        intValue: 3,
      });

      expect(result.ok).toBe(true);
      expect(await auditCountFor(hoId)).toBe(1);
    } finally {
      await cleanup(hoId, [siteA]);
    }
  });
});

describe("updateRuleConfig (issue #52 task 5)", () => {
  test("rejects an admin actor by redirecting (never a 200-with-error)", async () => {
    actor = {
      id: randomUUID(),
      name: "T5 Admin",
      email: "unused",
      role: "admin",
      siteId: null,
      siteLocationId: randomUUID(),
      isActive: true,
    };

    const { updateRuleConfig } = await import("./rule-config-actions");
    let thrown: unknown;
    try {
      await updateRuleConfig({ ruleKey: "C1", scope: "global", intValue: 5 });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Redirected);
    expect((thrown as Redirected).url).toBe("/dashboard");
  });

  test("forces a ho's site scope onto their own binding", async () => {
    const siteA = await seedSite();
    const siteB = await seedSite();
    const hoId = await seedUser("ho", siteA);

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C1",
        scope: "site",
        intValue: 6,
      });
      expect(result.ok).toBe(true);

      // The row (and only the row) sits in the ho's own site.
      const rows = await db
        .select({ siteId: rosterRuleConfig.siteId, intValue: rosterRuleConfig.intValue })
        .from(rosterRuleConfig)
        .where(and(eq(rosterRuleConfig.ruleKey, "C1"), isNull(rosterRuleConfig.deletedAt)));
      expect(rows).toEqual([{ siteId: siteA, intValue: 6 }]);
    } finally {
      await cleanup(hoId, [siteA, siteB]);
    }
  });

  test("refuses a site-scoped write from a null-bound ho", async () => {
    const hoId = await seedUser("ho", null);

    try {
      actor = {
        id: hoId,
        name: "T5 HO Unbound",
        email: mkEmail(hoId),
        role: "ho",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C2",
        scope: "site",
        intValue: 18,
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.siteId).toBeTruthy();
      expect(await auditCountFor(hoId)).toBe(0);
      // Nothing leaked to the global scope either.
      const globals = await db
        .select({ id: rosterRuleConfig.id })
        .from(rosterRuleConfig)
        .where(
          and(
            eq(rosterRuleConfig.ruleKey, "C2"),
            isNull(rosterRuleConfig.siteId),
            isNull(rosterRuleConfig.siteLocationId),
          ),
        );
      expect(globals).toEqual([]);
    } finally {
      await cleanup(hoId, []);
    }
  });

  test("refuses a ho's global-scope write with a field error and no audit row", async () => {
    const siteA = await seedSite();
    const hoId = await seedUser("ho", siteA);

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C3",
        scope: "global",
        boolValue: false,
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.scope).toBeTruthy();
      expect(await auditCountFor(hoId)).toBe(0);
      // Nothing leaked to the global base either.
      const globals = await db
        .select({ id: rosterRuleConfig.id })
        .from(rosterRuleConfig)
        .where(
          and(
            eq(rosterRuleConfig.ruleKey, "C3"),
            isNull(rosterRuleConfig.siteId),
            isNull(rosterRuleConfig.siteLocationId),
          ),
        );
      expect(globals).toEqual([]);
    } finally {
      await cleanup(hoId, [siteA]);
    }
  });

  test("refuses a superadmin site-scope write with a field error and no audit row", async () => {
    // A superadmin is unbound and the input carries no site selector, so a
    // site-scoped write has no writable target — it must refuse, never
    // silently fall through to the global base.
    const superId = await seedUser("superadmin", null);

    try {
      actor = {
        id: superId,
        name: "T5 Super",
        email: mkEmail(superId),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C7",
        scope: "site",
        boolValue: false,
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.siteId).toBeTruthy();
      expect(await auditCountFor(superId)).toBe(0);
      const globals = await db
        .select({ id: rosterRuleConfig.id })
        .from(rosterRuleConfig)
        .where(
          and(
            eq(rosterRuleConfig.ruleKey, "C7"),
            isNull(rosterRuleConfig.siteId),
            isNull(rosterRuleConfig.siteLocationId),
          ),
        );
      expect(globals).toEqual([]);
    } finally {
      await cleanup(superId, []);
    }
  });

  test("rejects a malformed siteLocationId with a field error, not a throw", async () => {
    // A client-reachable call with garbage in the uuid column must answer a
    // field error — the ownership query must never see the raw value.
    const siteA = await seedSite();
    const hoId = await seedUser("ho", siteA);

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C1",
        scope: "location",
        siteLocationId: "not-a-uuid",
        intValue: 6,
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.siteLocationId).toBeTruthy();
      expect(await auditCountFor(hoId)).toBe(0);
    } finally {
      await cleanup(hoId, [siteA]);
    }
  });

  test("rejects a location override outside the actor's site", async () => {
    const siteA = await seedSite();
    const siteB = await seedSite();
    const locB = await seedLocation(siteB);
    const hoId = await seedUser("ho", siteA);

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C1",
        scope: "location",
        siteLocationId: locB,
        intValue: 6,
      });

      // Foreign locations answer "not found." — never leak the row.
      expect(result).toEqual({ ok: false, message: "Location not found." });
      expect(await auditCountFor(hoId)).toBe(0);
      const rows = await db
        .select({ id: rosterRuleConfig.id })
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.siteLocationId, locB));
      expect(rows).toEqual([]);
    } finally {
      await cleanup(hoId, [siteA, siteB]);
    }
  });

  test("rejects C6 greater than C5 with a field error and no audit row", async () => {
    const siteA = await seedSite();
    const hoId = await seedUser("ho", siteA);
    // Site-level C5 override of 3: the effective C5 at this scope.
    await db.insert(rosterRuleConfig).values({
      id: randomUUID(),
      ruleKey: "C5",
      siteId: siteA,
      intValue: 3,
    });

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C6",
        scope: "site",
        intValue: 5,
      });

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.intValue).toBeTruthy();
      expect(await auditCountFor(hoId)).toBe(0);
      const c6Rows = await db
        .select({ id: rosterRuleConfig.id })
        .from(rosterRuleConfig)
        .where(
          and(eq(rosterRuleConfig.ruleKey, "C6"), eq(rosterRuleConfig.siteId, siteA)),
        );
      expect(c6Rows).toEqual([]);

      // Positive control: a C6 within C5 goes through (and is audited).
      const accepted = await updateRuleConfig({
        ruleKey: "C6",
        scope: "site",
        intValue: 2,
      });
      expect(accepted.ok).toBe(true);
      expect(await auditCountFor(hoId)).toBe(1);
    } finally {
      await cleanup(hoId, [siteA]);
    }
  });

  test("writes an audit record on an accepted ho write", async () => {
    const siteA = await seedSite();
    const hoId = await seedUser("ho", siteA);

    try {
      actor = {
        id: hoId,
        name: "T5 HO",
        email: mkEmail(hoId),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C1",
        scope: "site",
        intValue: 6,
      });
      expect(result.ok).toBe(true);

      const audits = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.actorId, hoId));
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe("roster_rule_config.change");
      expect(audits[0].actorId).toBe(hoId);
      expect(audits[0].siteId).toBe(siteA);
      expect(audits[0].siteLocationId).toBeNull();
      expect(audits[0].details).toEqual({
        ruleKey: "C1",
        level: "site",
        oldValue: null,
        newValue: { intValue: 6, boolValue: null },
      });
    } finally {
      await cleanup(hoId, [siteA]);
    }
  });

  test("superadmin location write derives siteId from the location's actual parent (no inconsistent pair)", async () => {
    const siteA = await seedSite();
    const siteB = await seedSite();
    const locA = await seedLocation(siteA);
    const superId = await seedUser("superadmin", null);

    try {
      actor = {
        id: superId,
        name: "T5 Super",
        email: mkEmail(superId),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { updateRuleConfig } = await import("./rule-config-actions");
      const result = await updateRuleConfig({
        ruleKey: "C2",
        scope: "location",
        siteLocationId: locA,
        intValue: 18,
      });
      expect(result.ok).toBe(true);

      // The write and its audit carry the location's real parent site —
      // the scope weld can never see a siteId that disagrees with the row.
      const rows = await db
        .select({
          siteId: rosterRuleConfig.siteId,
          siteLocationId: rosterRuleConfig.siteLocationId,
          intValue: rosterRuleConfig.intValue,
        })
        .from(rosterRuleConfig)
        .where(eq(rosterRuleConfig.ruleKey, "C2"));
      expect(rows).toEqual([
        { siteId: siteA, siteLocationId: locA, intValue: 18 },
      ]);

      const audits = await db
        .select({ siteId: auditLog.siteId, siteLocationId: auditLog.siteLocationId })
        .from(auditLog)
        .where(eq(auditLog.actorId, superId));
      expect(audits).toEqual([{ siteId: siteA, siteLocationId: locA }]);
    } finally {
      await cleanup(superId, [siteA, siteB]);
    }
  });
});
