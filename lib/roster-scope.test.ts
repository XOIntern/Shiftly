import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "./db";
import { rosterPlanMutationWhere, rosterPlanOwnedByActor } from "./roster-scope";
import { rosterPlan, site, siteLocation, user } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// Roster-plan scoping: superadmin unbounded; an admin pinned to their own
// site_location; an ho READS their own site's plans but every ho mutation
// predicate is a match-nothing `sql`false``. The binding read grant is the
// same shape as the Cycle A helpers. Fixtures prefixed t-roster- and
// cleaned up FK-safely; asserts are presence/exclusion, never global counts.
const MONDAY = "2026-01-05";

async function seedUser(tag: string): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: `t-roster-scope-${tag}`,
    email: `t-roster-scope-${tag}-${id}@shiftly.test`,
  });
  return id;
}

async function seedPlan(args: {
  siteId: string;
  siteLocationId: string;
  id?: string;
}): Promise<string> {
  const id = args.id ?? randomUUID();
  await db.insert(rosterPlan).values({
    id,
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    kind: "weekly",
    weekStart: MONDAY,
    rulesSnapshot: {},
  });
  return id;
}

describe("roster-plan ownership guard", () => {
  test("admin bound to location A owns their plan, not location B's; ho reads both under their site", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const adminId = await seedUser("owner");
    const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };
    const ho = { role: "ho" as const, siteId, siteLocationId: null };
    let ownId = "";
    let foreignId = "";

    fixtureCleanup.defer(async () => {
      await db.delete(rosterPlan).where(inArray(rosterPlan.id, [ownId, foreignId]));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, adminId));
    });
    await db.insert(site).values({ id: siteId, name: `t-roster-scope-site-${siteId}` });
    await db.insert(siteLocation).values([
      { id: locAId, siteId, name: `t-roster-scope-loc-a-${locAId}` },
      { id: locBId, siteId, name: `t-roster-scope-loc-b-${locBId}` },
    ]);
    ownId = await seedPlan({ siteId, siteLocationId: locAId });
    foreignId = await seedPlan({ siteId, siteLocationId: locBId });

    expect(await rosterPlanOwnedByActor(admin, ownId)).toBe(true);
    expect(await rosterPlanOwnedByActor(admin, foreignId)).toBe(false);
    // The ho's site covers both locations — read grant only.
    expect(await rosterPlanOwnedByActor(ho, ownId)).toBe(true);
    expect(await rosterPlanOwnedByActor(ho, foreignId)).toBe(true);

    // Presence: the rows were really there with their location welds.
    const rows = await db
      .select({ id: rosterPlan.id, siteLocationId: rosterPlan.siteLocationId })
      .from(rosterPlan)
      .where(inArray(rosterPlan.id, [ownId, foreignId]));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === ownId)?.siteLocationId).toBe(locAId);
  });

  test("superadmin is unbounded; unbound admin and ho are denied", async () => {
    const superadmin = { role: "superadmin" as const, siteId: null, siteLocationId: null };
    expect(
      await rosterPlanOwnedByActor(superadmin, randomUUID()), // no row exists at all
    ).toBe(true);
    expect(
      await rosterPlanOwnedByActor(
        { role: "admin", siteId: null, siteLocationId: null },
        randomUUID(),
      ),
    ).toBe(false);
    expect(
      await rosterPlanOwnedByActor({ role: "ho", siteId: null, siteLocationId: null }, randomUUID()),
    ).toBe(false);
  });
});

describe("roster-plan mutation weld", () => {
  test("ho read-own-site grant never mutates: the ho predicate matches nothing", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const adminId = await seedUser("weld-ho");
    const ho = { role: "ho" as const, siteId, siteLocationId: null };
    const planId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(rosterPlan).where(eq(rosterPlan.id, planId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, adminId));
    });
    await db.insert(site).values({ id: siteId, name: `t-roster-scope-site-${siteId}` });
    await db.insert(siteLocation).values({ id: locId, siteId, name: `t-roster-scope-loc-${locId}` });
    // The plan IS under the ho's own site — the read grant clearly covers it.
    await seedPlan({ siteId, siteLocationId: locId, id: planId });
    expect(await rosterPlanOwnedByActor(ho, planId)).toBe(true);

    // ...yet the ho's mutation predicate updates nothing (fail-closed).
    const updated = await db
      .update(rosterPlan)
      .set({ version: 9 })
      .where(rosterPlanMutationWhere(ho, planId))
      .returning({ id: rosterPlan.id });
    expect(updated).toHaveLength(0);
  });

  test("admin's own-location update goes through; foreign-location and unbound admins touch nothing", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const adminId = await seedUser("weld-admin");
    const ownId = randomUUID();
    const foreignId = randomUUID();
    const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };

    fixtureCleanup.defer(async () => {
      await db.delete(rosterPlan).where(inArray(rosterPlan.id, [ownId, foreignId]));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, adminId));
    });
    await db.insert(site).values({ id: siteId, name: `t-roster-scope-site-${siteId}` });
    await db.insert(siteLocation).values([
      { id: locAId, siteId, name: `t-roster-scope-loc-a-${locAId}` },
      { id: locBId, siteId, name: `t-roster-scope-loc-b-${locBId}` },
    ]);
    await seedPlan({ siteId, siteLocationId: locAId, id: ownId });
    await seedPlan({ siteId, siteLocationId: locBId, id: foreignId });

    // Positive control: own-location version bump goes through.
    const bumped = await db
      .update(rosterPlan)
      .set({ version: 2 })
      .where(rosterPlanMutationWhere(admin, ownId))
      .returning({ id: rosterPlan.id, version: rosterPlan.version });
    expect(bumped).toHaveLength(1);
    expect(bumped[0].version).toBe(2);

    // Foreign-location plan: welded update touches nothing.
    const hijacked = await db
      .update(rosterPlan)
      .set({ version: 9 })
      .where(rosterPlanMutationWhere(admin, foreignId))
      .returning({ id: rosterPlan.id });
    expect(hijacked).toHaveLength(0);

    // Unbound admin fails closed too.
    const unbound = await db
      .update(rosterPlan)
      .set({ version: 9 })
      .where(
        rosterPlanMutationWhere(
          { role: "admin", siteId: null, siteLocationId: null },
          ownId,
        ),
      )
      .returning({ id: rosterPlan.id });
    expect(unbound).toHaveLength(0);
  });

  test("superadmin welds by id alone", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const adminId = await seedUser("weld-super");
    const superadmin = { role: "superadmin" as const, siteId: null, siteLocationId: null };
    const planId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(rosterPlan).where(eq(rosterPlan.id, planId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, adminId));
    });
    await db.insert(site).values({ id: siteId, name: `t-roster-scope-site-${siteId}` });
    await db.insert(siteLocation).values({ id: locId, siteId, name: `t-roster-scope-loc-${locId}` });
    await seedPlan({ siteId, siteLocationId: locId, id: planId });

    const bumped = await db
      .update(rosterPlan)
      .set({ version: 3 })
      .where(rosterPlanMutationWhere(superadmin, planId))
      .returning({ id: rosterPlan.id, version: rosterPlan.version });
    expect(bumped).toHaveLength(1);
    expect(bumped[0].version).toBe(3);
  });
});
