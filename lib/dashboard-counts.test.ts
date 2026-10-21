import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { dashboardCounts } from "./dashboard-counts";
import { position, site, siteLocation, workArea, worker } from "../drizzle/schema";

// Honest dashboard home (#122): role-scoped active master-data counts,
// exercised against the real dev DB (docker shiftly-postgres :5433). The
// predicates must mirror the list pages' branch logic — fail closed on an
// unbound actor — so the suite seeds two sites and asserts per-role scoped
// sizes, never global counts.
//
// Fixtures (all names prefixed `t21-dash-`, deleted in afterAll):
//   site A — locations A1+A2, position P-A, work area W-A (A1),
//            workers W1 (A1, active), W2 (A1, soft-deleted), W3 (A1, inactive)
//   site B — location B1, active worker W-B
const SITE_A = randomUUID();
const SITE_B = randomUUID();
const LOC_A1 = randomUUID();
const LOC_A2 = randomUUID();
const LOC_B1 = randomUUID();
const POSITION_A = randomUUID();
const WORK_AREA_A = randomUUID();
const W1 = randomUUID();
const W2 = randomUUID();
const W3 = randomUUID();
const W_B = randomUUID();

beforeAll(async () => {
  await db.insert(site).values([
    { id: SITE_A, name: `t21-dash-site-a-${SITE_A}` },
    { id: SITE_B, name: `t21-dash-site-b-${SITE_B}` },
  ]);
  await db.insert(siteLocation).values([
    { id: LOC_A1, siteId: SITE_A, name: `t21-dash-loc-a1-${LOC_A1}` },
    { id: LOC_A2, siteId: SITE_A, name: `t21-dash-loc-a2-${LOC_A2}` },
    { id: LOC_B1, siteId: SITE_B, name: `t21-dash-loc-b1-${LOC_B1}` },
  ]);
  await db
    .insert(position)
    .values({ id: POSITION_A, siteId: SITE_A, name: `t21-dash-pos-${POSITION_A}` });
  await db.insert(workArea).values({
    id: WORK_AREA_A,
    siteLocationId: LOC_A1,
    siteId: SITE_A,
    name: `t21-dash-wa-${WORK_AREA_A}`,
  });
  await db.insert(worker).values([
    {
      id: W1,
      siteLocationId: LOC_A1,
      siteId: SITE_A,
      employeeId: `t21-dash-w1-${W1}`,
      name: "t21-dash W1 active",
    },
    {
      id: W2,
      siteLocationId: LOC_A1,
      siteId: SITE_A,
      employeeId: `t21-dash-w2-${W2}`,
      name: "t21-dash W2 soft-deleted",
      deletedAt: new Date(),
    },
    {
      id: W3,
      siteLocationId: LOC_A1,
      siteId: SITE_A,
      employeeId: `t21-dash-w3-${W3}`,
      name: "t21-dash W3 inactive",
      isActive: false,
    },
    {
      id: W_B,
      siteLocationId: LOC_B1,
      siteId: SITE_B,
      employeeId: `t21-dash-wb-${W_B}`,
      name: "t21-dash W-B active",
    },
  ]);
});

afterAll(async () => {
  // Reverse dependency order: workers → work_area → position →
  // site_location → site. Runs even after assertion failures.
  await db.delete(worker).where(eq(worker.id, W1));
  await db.delete(worker).where(eq(worker.id, W2));
  await db.delete(worker).where(eq(worker.id, W3));
  await db.delete(worker).where(eq(worker.id, W_B));
  await db.delete(workArea).where(eq(workArea.id, WORK_AREA_A));
  await db.delete(position).where(eq(position.id, POSITION_A));
  await db.delete(siteLocation).where(eq(siteLocation.id, LOC_A1));
  await db.delete(siteLocation).where(eq(siteLocation.id, LOC_A2));
  await db.delete(siteLocation).where(eq(siteLocation.id, LOC_B1));
  await db.delete(site).where(eq(site.id, SITE_A));
  await db.delete(site).where(eq(site.id, SITE_B));
});

describe("dashboardCounts", () => {
  test("superadmin sees all live+active master data across sites", async () => {
    const counts = await dashboardCounts({
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
    });
    // ≥ because other suites may share the dev DB: W1 + W-B visible, the
    // soft-deleted W2 and the inactive W3 excluded from workers.
    expect(counts.workers).toBeGreaterThanOrEqual(2);
    expect(counts.locations).toBeGreaterThanOrEqual(3);
  });

  test("ho bound to site A: own site only", async () => {
    const counts = await dashboardCounts({
      role: "ho",
      siteId: SITE_A,
      siteLocationId: null,
    });
    // W1 only — W2 (deleted) and W3 (inactive) are excluded.
    expect(counts.workers).toBe(1);
    // A1 + A2 — B1 belongs to another site.
    expect(counts.locations).toBe(2);
    expect(counts.positions).toBeGreaterThanOrEqual(1);
  });

  test("admin bound to location A1: own row, own work areas, site-wide positions", async () => {
    const counts = await dashboardCounts({
      role: "admin",
      siteId: null,
      siteLocationId: LOC_A1,
    });
    expect(counts.workers).toBe(1);
    expect(counts.workAreas).toBe(1);
    // Positions are site-wide: the binding's site A resolves through the
    // scalar subquery on site_location.
    expect(counts.positions).toBeGreaterThanOrEqual(1);
    // Their own location row — not a site-wide count.
    expect(counts.locations).toBe(1);
  });

  test("unbound actor counts nothing — never a crash", async () => {
    const unboundHo = await dashboardCounts({
      role: "ho",
      siteId: null,
      siteLocationId: null,
    });
    expect(unboundHo).toEqual({ workers: 0, positions: 0, workAreas: 0, locations: 0 });

    const unboundAdmin = await dashboardCounts({
      role: "admin",
      siteId: null,
      siteLocationId: null,
    });
    expect(unboundAdmin).toEqual({ workers: 0, positions: 0, workAreas: 0, locations: 0 });
  });
});
