import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import {
  positionMutationWhere,
  positionOwnedByActor,
} from "./position-scope";
import { position, site, siteLocation } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// Positions epic: the ownership guard + weld for the position table,
// mirroring lib/work-area-scope.test.ts's approach — the seam the server
// actions call, exercised against the real dev DB (docker
// shiftly-postgres :5433).
//
// Position ownership is SITE-scoped only (position has no location column):
// superadmin unscoped, ho via position.site_id, admin via the site of their
// site_location binding — each fail closed on a null binding.
describe("position ownership guard", () => {
  test("admin bound to a location of site A does not own a position under site B", async () => {
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const locAId = randomUUID();
    const positionId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    });
    await db.insert(site).values([
      { id: siteAId, name: `pos-scope-a-${siteAId}` },
      { id: siteBId, name: `pos-scope-b-${siteBId}` },
    ]);
    await db.insert(siteLocation).values({
      id: locAId,
      siteId: siteAId,
      name: `pos-scope-loc-${locAId}`,
    });
    await db.insert(position).values({
      id: positionId,
      siteId: siteBId, // foreign to the admin's binding site
      name: "Foreign Position",
    });

    expect(
      await positionOwnedByActor(
        { role: "admin", siteId: null, siteLocationId: locAId },
        positionId,
      ),
    ).toBe(false);

    const [row] = await db
      .select()
      .from(position)
      .where(eq(position.id, positionId));
    expect(row).toBeTruthy();
    expect(row.siteId).toBe(siteBId);
    expect(row.name).toBe("Foreign Position");
    expect(row.isActive).toBe(true);
  });

  test("positive control: admin owns a position under their binding's site; ho owns one under their own site", async () => {
    const siteId = randomUUID();
    const locId = randomUUID();
    const positionAId = randomUUID();
    const positionBId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionAId));
      await db.delete(position).where(eq(position.id, positionBId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: `pos-own-${siteId}` });
    await db.insert(siteLocation).values({
      id: locId,
      siteId,
      name: `pos-own-loc-${locId}`,
    });
    await db.insert(position).values([
      { id: positionAId, siteId, name: "Admin's Position" },
      { id: positionBId, siteId, name: "Ho's Position" },
    ]);

    expect(
      await positionOwnedByActor(
        { role: "admin", siteId: null, siteLocationId: locId },
        positionAId,
      ),
    ).toBe(true);
    expect(
      await positionOwnedByActor(
        { role: "ho", siteId, siteLocationId: null },
        positionBId,
      ),
    ).toBe(true);
  });

  test("superadmin stays unscoped; unbound admin and unbound ho are denied", async () => {
    const positionId = randomUUID(); // no row exists at all
    expect(
      await positionOwnedByActor(
        { role: "superadmin", siteId: null, siteLocationId: null },
        positionId,
      ),
    ).toBe(true);
    // An admin with no location binding has no derivable site: fail closed.
    expect(
      await positionOwnedByActor(
        { role: "admin", siteId: null, siteLocationId: null },
        positionId,
      ),
    ).toBe(false);
    // position.site_id is NOT NULL: an unbound ho can never match either.
    expect(
      await positionOwnedByActor(
        { role: "ho", siteId: null, siteLocationId: null },
        positionId,
      ),
    ).toBe(false);
  });
});

describe("position ownership weld", () => {
  test("foreign-site admin: welded update/toggle/soft-delete probes touch nothing", async () => {
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const locAId = randomUUID();
    const positionId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    });
    await db.insert(site).values([
      { id: siteAId, name: `posweld-a-${siteAId}` },
      { id: siteBId, name: `posweld-b-${siteBId}` },
    ]);
    await db.insert(siteLocation).values({
      id: locAId,
      siteId: siteAId,
      name: `posweld-loc-${locAId}`,
    });
    await db.insert(position).values({
      id: positionId,
      siteId: siteBId,
      name: "Foreign Position",
    });
    const admin = {
      role: "admin" as const,
      siteId: null,
      siteLocationId: locAId,
    };

    const probe = await db.transaction(async (tx) => {
      const renamed = await tx
        .update(position)
        .set({ name: "Hijacked" })
        .where(positionMutationWhere(admin, positionId))
        .returning({ id: position.id });
      const toggled = await tx
        .update(position)
        .set({ isActive: sql`not ${position.isActive}` })
        .where(positionMutationWhere(admin, positionId))
        .returning({ id: position.id });
      const hidden = await tx
        .update(position)
        .set({ deletedAt: new Date() })
        .where(positionMutationWhere(admin, positionId))
        .returning({ id: position.id });
      return { renamed, toggled, hidden };
    });

    expect(probe.renamed).toHaveLength(0);
    expect(probe.toggled).toHaveLength(0);
    expect(probe.hidden).toHaveLength(0);

    const [row] = await db
      .select()
      .from(position)
      .where(eq(position.id, positionId));
    expect(row).toBeTruthy();
    expect(row.siteId).toBe(siteBId);
    expect(row.name).toBe("Foreign Position");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
  });

  test("unbound admin: the welded WHERE fails closed even against an existing row", async () => {
    const siteId = randomUUID();
    const positionId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: `posweld-unb-${siteId}` });
    await db.insert(position).values({
      id: positionId,
      siteId,
      name: "Unbound Target",
    });

    const toggled = await db
      .update(position)
      .set({ isActive: sql`not ${position.isActive}` })
      .where(
        positionMutationWhere(
          { role: "admin", siteId: null, siteLocationId: null },
          positionId,
        ),
      )
      .returning({ id: position.id });
    expect(toggled).toHaveLength(0);
    const [row] = await db
      .select()
      .from(position)
      .where(eq(position.id, positionId));
    expect(row.isActive).toBe(true);
  });

  test("positive control: the weld lets an ho toggle/soft-delete under their own site", async () => {
    const siteId = randomUUID();
    const positionId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: `posweld-ho-${siteId}` });
    await db.insert(position).values({
      id: positionId,
      siteId,
      name: "Ho Weld Position",
    });
    const ho = { role: "ho" as const, siteId, siteLocationId: null };

    const probe = await db.transaction(async (tx) => {
      const toggled = await tx
        .update(position)
        .set({ isActive: sql`not ${position.isActive}` })
        .where(positionMutationWhere(ho, positionId))
        .returning({ isActive: position.isActive });
      const hidden = await tx
        .update(position)
        .set({ deletedAt: new Date() })
        .where(positionMutationWhere(ho, positionId))
        .returning({ id: position.id });
      return { toggled, hidden };
    });

    expect(probe.toggled).toEqual([{ isActive: false }]);
    expect(probe.hidden).toHaveLength(1);
  });

  test("bulk form: superadmin matches all ids, an unbound ho matches none", async () => {
    const siteId = randomUUID();
    const positionAId = randomUUID();
    const positionBId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionAId));
      await db.delete(position).where(eq(position.id, positionBId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: `posbulk-${siteId}` });
    await db.insert(position).values([
      { id: positionAId, siteId, name: "Bulk A" },
      { id: positionBId, siteId, name: "Bulk B" },
    ]);

    const { positionBulkMutationWhere } = await import("./position-scope");

    const unboundToggled = await db
      .update(position)
      .set({ isActive: sql`not ${position.isActive}` })
      .where(
        positionBulkMutationWhere(
          { role: "ho", siteId: null, siteLocationId: null },
          [positionAId, positionBId],
        ),
      )
      .returning({ id: position.id });
    expect(unboundToggled).toHaveLength(0);

    const saToggled = await db
      .update(position)
      .set({ isActive: sql`not ${position.isActive}` })
      .where(
        positionBulkMutationWhere(
          { role: "superadmin", siteId: null, siteLocationId: null },
          [positionAId, positionBId],
        ),
      )
      .returning({ id: position.id });
    expect(saToggled).toHaveLength(2);
  });
});
