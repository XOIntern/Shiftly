import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { position, site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The position actions resolve their actor through requireUser — swapped
// for a stub so the real server actions read against the test database.
// The mock swaps the WHOLE module across bun's single test process, so every
// export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// No Next request context under bun test — revalidation is a no-op stub.
// Real exports kept (revalidateTag, updateTag, … stay available to suites that
// run after this one: module mocks are process-wide); only revalidatePath is
// replaced, since there is no Next request context under bun test.
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T8 Position Actor",
    email: `t8-pos-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

describe("positions bulk actions", () => {
  test("ho toggles only its own site's positions", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const posA1 = randomUUID();
    const posA2 = randomUUID();
    const posB1 = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, posA1));
      await db.delete(position).where(eq(position.id, posA2));
      await db.delete(position).where(eq(position.id, posB1));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    });
    await db.insert(site).values([
      { id: siteA, name: `t8-pos-s-a-${siteA}` },
      { id: siteB, name: `t8-pos-s-b-${siteB}` },
    ]);
    await db.insert(position).values([
      { id: posA1, siteId: siteA, name: "T8 Pos A1" },
      { id: posA2, siteId: siteA, name: "T8 Pos A2" },
      { id: posB1, siteId: siteB, name: "T8 Pos B1" },
    ]);

    actor = makeActor("ho", siteA, null);

    const { setActiveBulk } = await import("./actions");
    const result = await setActiveBulk([posA1, posA2, posB1], false);

    expect(result.ok).toBe(true);
    // Of the three requested, two sit in the ho's own site; the third
    // belongs to another site and stays untouched.
    expect(result.applied).toBe(2);

    const rows = await db
      .select({ id: position.id, isActive: position.isActive })
      .from(position);
    const stateOf = (id: string) =>
      rows.find((row) => row.id === id)?.isActive;
    expect(stateOf(posA1)).toBe(false);
    expect(stateOf(posA2)).toBe(false);
    expect(stateOf(posB1)).toBe(true);
  });

  test("admin mutates only positions under their binding's site", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const posA1 = randomUUID();
    const posB1 = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, posA1));
      await db.delete(position).where(eq(position.id, posB1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    });
    await db.insert(site).values([
      { id: siteA, name: `t8-pos-adm-a-${siteA}` },
      { id: siteB, name: `t8-pos-adm-b-${siteB}` },
    ]);
    await db.insert(siteLocation).values({
      id: locA,
      siteId: siteA,
      name: "T8 Pos Adm Loc",
    });
    await db.insert(position).values([
      { id: posA1, siteId: siteA, name: "T8 Pos Adm A" },
      { id: posB1, siteId: siteB, name: "T8 Pos Adm B" },
    ]);

    actor = makeActor("admin", null, locA);

    const { setActiveBulk } = await import("./actions");
    const result = await setActiveBulk([posA1, posB1], false);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);

    const rows = await db
      .select({ id: position.id, isActive: position.isActive })
      .from(position);
    const stateOf = (id: string) =>
      rows.find((row) => row.id === id)?.isActive;
    expect(stateOf(posA1)).toBe(false);
    expect(stateOf(posB1)).toBe(true);
  });

  test("ho create ignores a client-sent foreign siteId — the action pins the actor's own site", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();

    fixtureCleanup.defer(async () => {
      // The action-created row is found by site, so it goes even when an
      // assertion above failed before its id was read.
      await db.delete(position).where(inArray(position.siteId, [siteA, siteB]));
      await db.delete(site).where(inArray(site.id, [siteA, siteB]));
    });
    await db.insert(site).values([
      { id: siteA, name: `t8-pin-a-${siteA}` },
      { id: siteB, name: `t8-pin-b-${siteB}` },
    ]);

    actor = makeActor("ho", siteA, null);

    const { createPosition } = await import("./actions");
    // The client asks for site B; the action must pin the ho's own site.
    const result = await createPosition({
      siteId: siteB,
      name: "T8 Pinned Position",
    });

    expect(result.ok).toBe(true);
    const [row] = await db
      .select({ id: position.id, siteId: position.siteId })
      .from(position)
      .where(eq(position.name, "T8 Pinned Position"));
    expect(row?.siteId).toBe(siteA);
  });

  test("superadmin create uses the picked site; duplicate live name refused with the mapped message", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();

    fixtureCleanup.defer(async () => {
      // The action-created rows are found by site, so they go even when an
      // assertion above failed.
      await db.delete(position).where(inArray(position.siteId, [siteA, siteB]));
      await db.delete(site).where(inArray(site.id, [siteA, siteB]));
    });
    await db.insert(site).values([{ id: siteA, name: `t8-sa-${siteA}` }]);

    actor = makeActor("superadmin", null, null);

    const { createPosition } = await import("./actions");
    const first = await createPosition({
      siteId: siteA,
      name: "T8 Duplicated",
    });
    expect(first.ok).toBe(true);

    const second = await createPosition({
      siteId: siteA,
      name: "T8 Duplicated",
    });
    expect(second.ok).toBe(false);
    expect(second.message).toBe("Position name already exists");

    // Same name under a different site is allowed.
    await db.insert(site).values([{ id: siteB, name: `t8-sa-b-${siteB}` }]);
    const cross = await createPosition({
      siteId: siteB,
      name: "T8 Duplicated",
    });
    expect(cross.ok).toBe(true);
  });

  test("foreign position answers 'Position not found.' to an ho's update/toggle/delete", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const posB1 = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, posB1));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    });
    await db.insert(site).values([
      { id: siteA, name: `t8-fn-a-${siteA}` },
      { id: siteB, name: `t8-fn-b-${siteB}` },
    ]);
    await db
      .insert(position)
      .values({ id: posB1, siteId: siteB, name: "T8 Foreign" });

    actor = makeActor("ho", siteA, null);

    const { updatePosition, togglePosition, deletePosition } =
      await import("./actions");

    const updated = await updatePosition(posB1, {
      name: "T8 Hijacked",
      isActive: false,
    });
    expect(updated).toEqual({ ok: false, message: "Position not found." });

    const toggled = await togglePosition(posB1);
    expect(toggled).toEqual({ ok: false, message: "Position not found." });

    const deleted = await deletePosition(posB1);
    expect(deleted).toEqual({ ok: false, message: "Position not found." });

    // The refusal writes nothing.
    const [row] = await db
      .select()
      .from(position)
      .where(eq(position.id, posB1));
    expect(row.name).toBe("T8 Foreign");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
  });

  test("an unbound admin mutates nothing, fail closed", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const posA1 = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, posA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    });
    await db.insert(site).values([{ id: siteA, name: `t8-unb-${siteA}` }]);
    await db
      .insert(siteLocation)
      .values({ id: locA, siteId: siteA, name: "T8 Unb Loc" });
    await db
      .insert(position)
      .values({ id: posA1, siteId: siteA, name: "T8 Unbound" });

    actor = makeActor("admin", null, null);

    const { setActiveBulk, deleteBulk, createPosition } =
      await import("./actions");
    const active = await setActiveBulk([posA1], false);
    expect(active.ok).toBe(true);
    expect(active.applied).toBe(0);

    const removed = await deleteBulk([posA1]);
    expect(removed.ok).toBe(true);
    expect(removed.applied).toBe(0);
    expect(removed.blocked).toBe(0);

    // Create is refused too: no binding to derive a site from.
    const created = await createPosition({ name: "T8 Unbound Create" });
    expect(created.ok).toBe(false);

    const rows = await db.select({ id: position.id }).from(position);
    expect(rows.find((row) => row.id === posA1)).toBeDefined();
  });

  test("deleteBulk soft-deletes only in-scope rows; deletePosition soft-deletes, not hard", async () => {
    const siteA = randomUUID();
    const posA1 = randomUUID();
    const posA2 = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, posA1));
      await db.delete(position).where(eq(position.id, posA2));
      await db.delete(site).where(eq(site.id, siteA));
    });
    await db.insert(site).values([{ id: siteA, name: `t8-del-${siteA}` }]);
    await db.insert(position).values([
      { id: posA1, siteId: siteA, name: "T8 Del Single" },
      { id: posA2, siteId: siteA, name: "T8 Del Bulk" },
    ]);

    actor = makeActor("superadmin", null, null);

    const { deletePosition, deleteBulk } = await import("./actions");

    const single = await deletePosition(posA1);
    expect(single.ok).toBe(true);
    const [singleRow] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, posA1));
    expect(singleRow.deletedAt).not.toBeNull();

    const bulk = await deleteBulk([posA1, posA2]);
    expect(bulk.ok).toBe(true);
    // The already-soft-deleted row is invisible to the bulk write; only
    // the live one is hidden now.
    expect(bulk.applied).toBe(1);
    expect(bulk.blocked).toBe(0);

    const [bulkRow] = await db
      .select({ deletedAt: position.deletedAt })
      .from(position)
      .where(eq(position.id, posA2));
    expect(bulkRow.deletedAt).not.toBeNull();
  });
});
