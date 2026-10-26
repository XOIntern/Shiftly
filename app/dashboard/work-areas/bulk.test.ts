import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  position,
  site,
  siteLocation,
  user,
  workArea,
  workAreaPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The work-area actions resolve their actor through requireUser — swapped
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
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

describe("work-areas bulk actions", () => {
  test("admin rewrites only its own site_location's work areas", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const waA = randomUUID();
    const waA2 = randomUUID();
    const waB = randomUUID();
    const adminA = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t5-wa-s-${siteA}` }]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T5 WA Loc A" },
        { id: locB, siteId: siteA, name: "T5 WA Loc B" },
      ]);
      await db.insert(workArea).values([
        { id: waA, siteLocationId: locA, siteId: siteA, name: "T5 WA A" },
        { id: waA2, siteLocationId: locA, siteId: siteA, name: "T5 WA A2" },
        { id: waB, siteLocationId: locB, siteId: siteA, name: "T5 WA B" },
      ]);
      await db.insert(user).values([
        {
          id: adminA,
          name: "T5 Admin",
          email: `t5-wa-${adminA}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
      ]);

      actor = {
        id: adminA,
        name: "T5 Admin",
        email: `t5-wa-${adminA}@shiftly.test`,
        role: "admin",
        siteId: null,
        siteLocationId: locA,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk([waA, waA2, waB], false);

      expect(result.ok).toBe(true);
      // Of the three requested, two sit in the admin's own site_location;
      // the third belongs to another location and stays untouched.
      expect(result.applied).toBe(2);

      const rows = await db
        .select({ id: workArea.id, isActive: workArea.isActive })
        .from(workArea);
      const stateOf = (id: string) =>
        rows.find((row) => row.id === id)?.isActive;
      expect(stateOf(waA)).toBe(false);
      expect(stateOf(waA2)).toBe(false);
      expect(stateOf(waB)).toBe(true);
    } finally {
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(workArea).where(eq(workArea.id, waA));
      await db.delete(workArea).where(eq(workArea.id, waA2));
      await db.delete(workArea).where(eq(workArea.id, waB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("admin cannot re-parent a work area into a foreign location", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const foreignLoc = randomUUID();
    const waA = randomUUID();
    const adminA = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t5-wa-rp-${siteA}` }]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T5 WA RP Loc" },
        { id: foreignLoc, siteId: siteA, name: "T5 WA RP Foreign" },
      ]);
      await db
        .insert(workArea)
        .values({ id: waA, siteLocationId: locA, siteId: siteA, name: "T5 WA RP" });
      await db.insert(user).values([
        {
          id: adminA,
          name: "T5 Admin RP",
          email: `t5-wa-${adminA}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
      ]);

      actor = {
        id: adminA,
        name: "T5 Admin RP",
        email: `t5-wa-${adminA}@shiftly.test`,
        role: "admin",
        siteId: null,
        siteLocationId: locA,
        isActive: true,
      };

      const { updateWorkArea } = await import("./actions");
      // The client asks for the foreign location; the action must pin the
      // actor's own site_location and never let an FK error escape.
      const result = await updateWorkArea(waA, {
        siteLocationId: foreignLoc,
        name: "T5 WA RP Renamed",
        isActive: true,
      });

      expect(result.ok).toBe(true);
      const [row] = await db
        .select({ siteLocationId: workArea.siteLocationId })
        .from(workArea)
        .where(eq(workArea.id, waA));
      expect(row.siteLocationId).toBe(locA);
    } finally {
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(workArea).where(eq(workArea.id, waA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, foreignLoc));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("superadmin create derives site_id from the chosen site_location", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locB = randomUUID();
    const posB = randomUUID();
    const saActor = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteA, name: `t5-wa-xs-a-${siteA}` },
        { id: siteB, name: `t5-wa-xs-b-${siteB}` },
      ]);
      await db
        .insert(siteLocation)
        .values({ id: locB, siteId: siteB, name: "T5 WA XS Loc" });
      await db
        .insert(position)
        .values({ id: posB, siteId: siteB, name: `t5-wa-xs-pos-${posB}` });

      actor = {
        id: saActor,
        name: "T5 Superadmin",
        email: `t5-wa-${saActor}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { createWorkArea } = await import("./actions");
      const result = await createWorkArea({
        siteLocationId: locB,
        name: "T5 WA XS",
        requiredPositionIds: [posB],
      });

      // siteId is never taken from the client: the action derives it from
      // the work area's own site_location, so the composite FK pairing is
      // decided server-side.
      expect(result.ok).toBe(true);
      const [row] = await db
        .select({ id: workArea.id, siteId: workArea.siteId })
        .from(workArea)
        .where(eq(workArea.siteLocationId, locB));
      expect(row?.siteId).toBe(siteB);
      if (row) {
        await db
          .delete(workAreaPosition)
          .where(eq(workAreaPosition.workAreaId, row.id));
        await db.delete(workArea).where(eq(workArea.id, row.id));
      }
    } finally {
      await db.delete(position).where(eq(position.id, posB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("an unbound admin (siteLocationId null) mutates nothing, fail closed", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const waA = randomUUID();
    const adminA = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t5-wa-ub-${siteA}` }]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T5 WA UB Loc" },
      ]);
      await db
        .insert(workArea)
        .values({ id: waA, siteLocationId: locA, siteId: siteA, name: "T5 WA UB" });
      await db.insert(user).values([
        {
          id: adminA,
          name: "T5 Unbound Admin",
          email: `t5-wa-${adminA}@shiftly.test`,
          emailVerified: true,
          role: "admin",
        },
      ]);

      actor = {
        id: adminA,
        name: "T5 Unbound Admin",
        email: `t5-wa-${adminA}@shiftly.test`,
        role: "admin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk, deleteBulk } = await import("./actions");
      const active = await setActiveBulk([waA], false);
      expect(active.ok).toBe(true);
      expect(active.applied).toBe(0);

      const removed = await deleteBulk([waA]);
      expect(removed.ok).toBe(true);
      expect(removed.applied).toBe(0);
      // The user work-area binding is gone: deleteBulk can never skip a
      // row, so no blocked counter travels at all.
      expect(removed.blocked).toBeUndefined();

      const rows = await db.select({ id: workArea.id }).from(workArea);
      expect(rows.find((row) => row.id === waA)).toBeDefined();
    } finally {
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(workArea).where(eq(workArea.id, waA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });
});
