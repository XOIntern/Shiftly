import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The bulk actions resolve their actor through requireSuperadmin — swapped
// for a stub so the real server actions read against the test database.
// The mock swaps the WHOLE module across bun's single test process, so
// every export other suites may resolve must exist here.
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

function siteRow(id: string): { id: string; name: string } {
  return { id, name: `t4-sites-bulk-${id}` };
}

describe("sites bulk actions", () => {
  test("setActiveBulk rewrites only the requested subset", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const siteC = randomUUID();

    try {
      await db.insert(site).values([
        siteRow(siteA),
        siteRow(siteB),
        // Pre-deactivated: proves the subset write never widens to the
        // table — an untouched row keeps its prior state.
        { ...siteRow(siteC), isActive: false },
      ]);

      actor = {
        id: randomUUID(),
        name: "T4 Superadmin Actor",
        email: `t4-sites-${siteA}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk([siteA, siteB], true);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(2);

      const rows = await db
        .select({ id: site.id, isActive: site.isActive })
        .from(site);
      const stateOf = (id: string) =>
        rows.find((row) => row.id === id)?.isActive;
      expect(stateOf(siteA)).toBe(true);
      expect(stateOf(siteB)).toBe(true);
      // The untouched row keeps false — no whole-table write.
      expect(stateOf(siteC)).toBe(false);
    } finally {
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
      await db.delete(site).where(eq(site.id, siteC));
    }
  });

  test("deleteBulk deletes empty sites, blocks sites that still own locations", async () => {
    const empty = randomUUID();
    const guarded = randomUUID();
    const locA = randomUUID();

    try {
      await db.insert(site).values([
        { ...siteRow(empty), isActive: false },
        { ...siteRow(guarded), isActive: false },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: guarded, name: "T4 Sites Bulk Loc" },
      ]);

      actor = {
        id: randomUUID(),
        name: "T4 Superadmin Actor",
        email: `t4-sites-${empty}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteBulk } = await import("./actions");
      const result = await deleteBulk([empty, guarded]);

      // One unregistered, one refused by the relation guard — a partial
      // success, not an all-or-nothing failure.
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.message).toContain("Locations still exist");

      const rows = await db
        .select({ id: site.id, deletedAt: site.deletedAt })
        .from(site);
      // Soft-delete epic #39: "deleted" now means deletedAt set, not a
      // vanished row.
      expect(rows.find((row) => row.id === empty)?.deletedAt).not.toBeNull();
      expect(rows.find((row) => row.id === guarded)?.deletedAt).toBeNull();

      // The guarded site is still intact: the bulk guard refuses it as a
      // skipped row, never a failure of the batch.
      const retry = await deleteBulk([guarded]);
      expect(retry.ok).toBe(true);
      expect(retry.applied).toBe(0);
      expect(retry.blocked).toBe(1);
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, guarded));
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, empty));
      await db.delete(site).where(eq(site.id, guarded));
    }
  });

  test("deleteBulk: an active site is a skipped row, an inactive one applies (issue #46)", async () => {
    const active = randomUUID();
    const inactive = randomUUID();

    try {
      await db.insert(site).values([
        siteRow(active),
        { ...siteRow(inactive), isActive: false },
      ]);

      actor = {
        id: randomUUID(),
        name: "T4 Superadmin Actor",
        email: `t4-sites-${active}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteBulk } = await import("./actions");
      const result = await deleteBulk([active, inactive]);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.message).toContain(
        "Deactivate the site before deleting it",
      );

      // The active site survives unarchived; the inactive one soft-deletes.
      const rows = await db
        .select({ id: site.id, deletedAt: site.deletedAt })
        .from(site);
      expect(rows.find((row) => row.id === active)?.deletedAt).toBeNull();
      expect(rows.find((row) => row.id === inactive)?.deletedAt).not.toBeNull();
    } finally {
      await db.delete(site).where(eq(site.id, active));
      await db.delete(site).where(eq(site.id, inactive));
    }
  });

  test("malformed ids are dropped, empty batch answers without writing", async () => {
    const siteA = randomUUID();

    try {
      await db.insert(site).values([siteRow(siteA)]);

      actor = {
        id: randomUUID(),
        name: "T4 Superadmin Actor",
        email: `t4-sites-${siteA}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk, deleteBulk } = await import("./actions");
      const result = await setActiveBulk(["not-a-uuid", siteA], false);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);

      const nothing = await deleteBulk([]);
      expect(nothing.ok).toBe(false);

      const nothingActive = await setActiveBulk([], false);
      expect(nothingActive.ok).toBe(false);
    } finally {
      await db.delete(site).where(eq(site.id, siteA));
    }
  });
});
