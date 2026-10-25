import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "./db";
import {
  mpRequestListWhere,
  mpRequestMutationWhere,
  mpRequestOwnedByActor,
} from "./mp-request-scope";
import { mpRequest, site, siteLocation, user } from "../drizzle/schema";

// MP-request scoping (Module 3, mp-requests epic): the seam the request
// actions call, exercised against the real dev DB. mp_request has both
// scope columns NOT NULL and no soft delete — an admin is pinned to their
// site_location, an ho to their site, a superadmin is unbounded, and every
// null binding fails closed. Fixtures are prefixed t-mp- and cleaned up.
const DAILY_ANCHOR = "2026-01-05";

async function seedUser(tag: string): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: `t-mp-scope-${tag}`,
    email: `t-mp-scope-${tag}-${id}@shiftly.test`,
  });
  return id;
}

async function seedRequest(args: {
  siteId: string;
  siteLocationId: string;
  createdBy: string;
  id?: string;
}): Promise<string> {
  const id = args.id ?? randomUUID();
  await db.insert(mpRequest).values({
    id,
    siteId: args.siteId,
    siteLocationId: args.siteLocationId,
    type: "daily",
    requestDate: DAILY_ANCHOR,
    createdBy: args.createdBy,
  });
  return id;
}

async function dropRequests(ids: string[]) {
  if (ids.length > 0) {
    await db.delete(mpRequest).where(inArray(mpRequest.id, ids));
  }
}

describe("mp-request ownership guard", () => {
  test("admin bound to location A owns their request, not location B's; ho owns both under their site", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const adminId = await seedUser("owner");
    const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };
    const ho = { role: "ho" as const, siteId, siteLocationId: null };

    try {
      await db.insert(site).values({ id: siteId, name: `t-mp-scope-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t-mp-scope-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t-mp-scope-loc-b-${locBId}` },
      ]);
      const ownId = await seedRequest({ siteId, siteLocationId: locAId, createdBy: adminId });
      const foreignId = await seedRequest({ siteId, siteLocationId: locBId, createdBy: adminId });

      expect(await mpRequestOwnedByActor(admin, ownId)).toBe(true);
      expect(await mpRequestOwnedByActor(admin, foreignId)).toBe(false);
      // The ho's site covers both locations.
      expect(await mpRequestOwnedByActor(ho, ownId)).toBe(true);
      expect(await mpRequestOwnedByActor(ho, foreignId)).toBe(true);

      // Presence: the rows were really there with their location welds.
      const rows = await db
        .select({ id: mpRequest.id, siteLocationId: mpRequest.siteLocationId })
        .from(mpRequest)
        .where(inArray(mpRequest.id, [ownId, foreignId]));
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === ownId)?.siteLocationId).toBe(locAId);

      await dropRequests([ownId, foreignId]);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, adminId));
    }
  });

  test("superadmin is unbounded; unbound admin and ho are denied", async () => {
    const superadmin = { role: "superadmin" as const, siteId: null, siteLocationId: null };
    expect(
      await mpRequestOwnedByActor(superadmin, randomUUID()), // no row exists at all
    ).toBe(true);
    expect(
      await mpRequestOwnedByActor(
        { role: "admin", siteId: null, siteLocationId: null },
        randomUUID(),
      ),
    ).toBe(false);
    expect(
      await mpRequestOwnedByActor({ role: "ho", siteId: null, siteLocationId: null }, randomUUID()),
    ).toBe(false);
  });
});

describe("mp-request mutation weld", () => {
  test("foreign-location admin: welded update touches nothing", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const adminId = await seedUser("weld");
    const requestId = randomUUID();
    const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };

    try {
      await db.insert(site).values({ id: siteId, name: `t-mp-scope-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t-mp-scope-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t-mp-scope-loc-b-${locBId}` },
      ]);
      const seededId = await seedRequest({
        siteId,
        siteLocationId: locBId,
        createdBy: adminId,
        id: requestId,
      });

      // Presence first: the row exists, and it is foreign to the admin.
      const [row] = await db
        .select({ id: mpRequest.id, siteLocationId: mpRequest.siteLocationId })
        .from(mpRequest)
        .where(eq(mpRequest.id, seededId));
      expect(row.siteLocationId).toBe(locBId);
      expect(await mpRequestOwnedByActor(admin, seededId)).toBe(false);

      const updated = await db
        .update(mpRequest)
        .set({ status: "received" })
        .where(mpRequestMutationWhere(admin, seededId))
        .returning({ id: mpRequest.id });
      expect(updated).toHaveLength(0);
    } finally {
      await dropRequests([requestId]);
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, adminId));
    }
  });

  test("positive control: admin's own-location update goes through; unbound admin fails closed", async () => {
    const siteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const adminId = await seedUser("weld-own");
    const ownId = randomUUID();
    const admin = { role: "admin" as const, siteId: null, siteLocationId: locAId };

    try {
      await db.insert(site).values({ id: siteId, name: `t-mp-scope-site-${siteId}` });
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t-mp-scope-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t-mp-scope-loc-b-${locBId}` },
      ]);
      await seedRequest({ siteId, siteLocationId: locAId, createdBy: adminId, id: ownId });
      // Presence: the row now exists under the admin's own location.
      const seeded = await db
        .select({ siteLocationId: mpRequest.siteLocationId })
        .from(mpRequest)
        .where(eq(mpRequest.id, ownId));
      expect(seeded).toHaveLength(1);
      expect(seeded[0].siteLocationId).toBe(locAId);

      const updated = await db
        .update(mpRequest)
        .set({ status: "received" })
        .where(mpRequestMutationWhere(admin, ownId))
        .returning({ id: mpRequest.id, status: mpRequest.status });
      expect(updated).toHaveLength(1);
      expect(updated[0].status).toBe("received");

      const unbound = await db
        .update(mpRequest)
        .set({ status: "processing" })
        .where(
          mpRequestMutationWhere(
            { role: "admin", siteId: null, siteLocationId: null },
            ownId,
          ),
        )
        .returning({ id: mpRequest.id });
      expect(unbound).toHaveLength(0);

      await dropRequests([ownId]);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(user).where(eq(user.id, adminId));
    }
  });

  test("ho weld: same-site rows are theirs, foreign-site rows are not", async () => {
    const ownSiteId = randomUUID();
    const otherSiteId = randomUUID();
    const ownLocId = randomUUID();
    const otherLocId = randomUUID();
    const adminId = await seedUser("weld-ho");
    const ho = { role: "ho" as const, siteId: ownSiteId, siteLocationId: null };

    try {
      await db.insert(site).values([
        { id: ownSiteId, name: `t-mp-scope-site-own-${ownSiteId}` },
        { id: otherSiteId, name: `t-mp-scope-site-other-${otherSiteId}` },
      ]);
      await db.insert(siteLocation).values([
        { id: ownLocId, siteId: ownSiteId, name: `t-mp-scope-loc-own-${ownLocId}` },
        { id: otherLocId, siteId: otherSiteId, name: `t-mp-scope-loc-other-${otherLocId}` },
      ]);
      const ownId = await seedRequest({
        siteId: ownSiteId,
        siteLocationId: ownLocId,
        createdBy: adminId,
      });
      const foreignId = await seedRequest({
        siteId: otherSiteId,
        siteLocationId: otherLocId,
        createdBy: adminId,
      });

      const hoUpdates = await db
        .update(mpRequest)
        .set({ status: "received" })
        .where(mpRequestMutationWhere(ho, ownId))
        .returning({ id: mpRequest.id });
      expect(hoUpdates).toHaveLength(1);

      expect(await mpRequestOwnedByActor(ho, foreignId)).toBe(false);
      const foreignUpdates = await db
        .update(mpRequest)
        .set({ status: "received" })
        .where(mpRequestMutationWhere(ho, foreignId))
        .returning({ id: mpRequest.id });
      expect(foreignUpdates).toHaveLength(0);

      await dropRequests([ownId, foreignId]);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, ownLocId));
      await db.delete(siteLocation).where(eq(siteLocation.id, otherLocId));
      await db.delete(site).where(eq(site.id, ownSiteId));
      await db.delete(site).where(eq(site.id, otherSiteId));
      await db.delete(user).where(eq(user.id, adminId));
    }
  });
});

describe("mp-request list filter", () => {
  test("admin sees only their location's rows; ho sees the whole site's; superadmin is unbounded", async () => {
    const siteId = randomUUID();
    const otherSiteId = randomUUID();
    const locAId = randomUUID();
    const locBId = randomUUID();
    const otherLocId = randomUUID();
    const adminId = await seedUser("list");
    const locARequestId = randomUUID();
    const locBRequestId = randomUUID();
    const otherSiteRequestId = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteId, name: `t-mp-scope-site-${siteId}` },
        { id: otherSiteId, name: `t-mp-scope-site-other-${otherSiteId}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locAId, siteId, name: `t-mp-scope-loc-a-${locAId}` },
        { id: locBId, siteId, name: `t-mp-scope-loc-b-${locBId}` },
        { id: otherLocId, siteId: otherSiteId, name: `t-mp-scope-loc-other-${otherLocId}` },
      ]);
      await seedRequest({ siteId, siteLocationId: locAId, createdBy: adminId, id: locARequestId });
      await seedRequest({ siteId, siteLocationId: locBId, createdBy: adminId, id: locBRequestId });
      await seedRequest({
        siteId: otherSiteId,
        siteLocationId: otherLocId,
        createdBy: adminId,
        id: otherSiteRequestId,
      });
      // Presence: all three rows really landed under their own welds.
      const seeded = await db
        .select({ id: mpRequest.id, siteLocationId: mpRequest.siteLocationId })
        .from(mpRequest)
        .where(
          inArray(mpRequest.id, [locARequestId, locBRequestId, otherSiteRequestId]),
        );
      expect(seeded).toHaveLength(3);

      const scopedIds = async (actor: Parameters<typeof mpRequestListWhere>[0]) => {
        const rows = await db
          .select({ id: mpRequest.id })
          .from(mpRequest)
          .where(mpRequestListWhere(actor));
        return new Set(rows.map((r) => r.id));
      };

      const adminView = await scopedIds({
        role: "admin",
        siteId: null,
        siteLocationId: locAId,
      });
      expect(adminView.has(locARequestId)).toBe(true);
      expect(adminView.has(locBRequestId)).toBe(false);
      expect(adminView.has(otherSiteRequestId)).toBe(false);

      const hoView = await scopedIds({ role: "ho", siteId, siteLocationId: null });
      expect(hoView.has(locARequestId)).toBe(true);
      expect(hoView.has(locBRequestId)).toBe(true);
      expect(hoView.has(otherSiteRequestId)).toBe(false);

      // Unbounded superadmin: the filter is undefined, so this run's rows
      // all show up (presence, never a global count).
      expect(
        mpRequestListWhere({ role: "superadmin", siteId: null, siteLocationId: null }),
      ).toBeUndefined();
      const superView = await scopedIds({
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
      });
      expect(superView.has(locARequestId)).toBe(true);
      expect(superView.has(otherSiteRequestId)).toBe(true);

      // Unbound actors fail closed: no seeded row leaks.
      const unboundAdmin = await scopedIds({
        role: "admin",
        siteId: null,
        siteLocationId: null,
      });
      expect(unboundAdmin.has(locARequestId)).toBe(false);
      const unboundHo = await scopedIds({ role: "ho", siteId: null, siteLocationId: null });
      expect(unboundHo.has(locARequestId)).toBe(false);

      await dropRequests([locARequestId, locBRequestId, otherSiteRequestId]);
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locAId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBId));
      await db.delete(siteLocation).where(eq(siteLocation.id, otherLocId));
      await db.delete(site).where(eq(site.id, siteId));
      await db.delete(site).where(eq(site.id, otherSiteId));
      await db.delete(user).where(eq(user.id, adminId));
    }
  });
});
