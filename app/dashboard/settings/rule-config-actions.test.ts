import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";

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
