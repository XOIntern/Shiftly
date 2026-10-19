import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { department, site, siteLocation, user, workArea } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";

// The bulk actions resolve their actor through requireHO — swapped for a
// stub so the real server actions read against the test database. The mock
// swaps the WHOLE module across bun's single test process, so every export
// other suites may resolve must exist here.
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

function departmentRow(id: string, siteId: string, name: string) {
  return { id, siteId, name };
}

describe("departments bulk actions", () => {
  test("ho rewrites only its own site's departments; foreign rows untouched", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const deptA = randomUUID();
    const deptC = randomUUID();
    const deptB = randomUUID();
    const hoActor = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteA, name: `t4-dept-sc-alpha-${siteA}` },
        { id: siteB, name: `t4-dept-sc-beta-${siteB}` },
      ]);
      await db.insert(department).values([
        departmentRow(deptA, siteA, "T4 Dept A"),
        departmentRow(deptC, siteA, "T4 Dept C"),
        departmentRow(deptB, siteB, "T4 Dept B"),
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO",
        email: `t4-dept-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk } = await import("./actions");
      const result = await setActiveBulk([deptA, deptC, deptB], false);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(2);

      const rows = await db
        .select({ id: department.id, isActive: department.isActive })
        .from(department);
      const stateOf = (id: string) =>
        rows.find((row) => row.id === id)?.isActive;
      expect(stateOf(deptA)).toBe(false);
      expect(stateOf(deptC)).toBe(false);
      expect(stateOf(deptB)).toBe(true);
    } finally {
      await db.delete(department).where(eq(department.id, deptA));
      await db.delete(department).where(eq(department.id, deptC));
      await db.delete(department).where(eq(department.id, deptB));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("deleteBulk skips departments with live bound users, deletes the rest", async () => {
    const siteA = randomUUID();
    const free = randomUUID();
    const bound = randomUUID();
    const memberA = randomUUID();
    const hoActor = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t4-dept-del-${siteA}` }]);
      await db.insert(department).values([
        departmentRow(free, siteA, "T4 Dept Free"),
        departmentRow(bound, siteA, "T4 Dept Bound"),
      ]);
      await db.insert(user).values([
        {
          id: memberA,
          name: "T4 Member",
          email: `t4-dept-${memberA}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          departmentId: bound,
        },
        {
          id: hoActor,
          name: "T4 Actor HO",
          email: `t4-dept-${hoActor}@shiftly.test`,
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO",
        email: `t4-dept-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteBulk } = await import("./actions");
      const result = await deleteBulk([free, bound]);

      // The free department soft-deletes (its row survives with deletedAt),
      // the user-bound one is skipped with the same guard message the
      // single-row path gives. Soft-delete epic #41.
      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.message).toContain("Users are still bound");

      const rows = await db
        .select({ id: department.id, deletedAt: department.deletedAt })
        .from(department);
      const freeRow = rows.find((row) => row.id === free);
      expect(freeRow).toBeDefined();
      expect(freeRow?.deletedAt).not.toBeNull();
      expect(rows.find((row) => row.id === bound)?.deletedAt).toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, memberA));
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(department).where(eq(department.id, free));
      await db.delete(department).where(eq(department.id, bound));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("deleteDepartment refuses a department with a live work area", async () => {
    const siteA = randomUUID();
    const loc = randomUUID();
    const dept = randomUUID();
    const wa = randomUUID();
    const hoActor = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t4-dept-wa-${siteA}` }]);
      await db.insert(siteLocation).values([
        { id: loc, siteId: siteA, name: "T4 Users Loc" },
      ]);
      await db.insert(department).values([departmentRow(dept, siteA, "T4 Dept WA")]);
      await db.insert(workArea).values([
        {
          id: wa,
          departmentId: dept,
          siteLocationId: loc,
          siteId: siteA,
          name: "T4 Dept WA Area",
        },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T4 Actor HO",
          email: `t4-dept-wa-${hoActor}@shiftly.test`,
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO",
        email: `t4-dept-wa-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteDepartment } = await import("./actions");
      const result = await deleteDepartment(dept);

      expect(result.ok).toBe(false);
      expect(result.message).toBe(
        "Work areas still exist under this department",
      );
      const [row] = await db
        .select({ deletedAt: department.deletedAt })
        .from(department)
        .where(eq(department.id, dept));
      expect(row?.deletedAt).toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(workArea).where(eq(workArea.id, wa));
      await db.delete(department).where(eq(department.id, dept));
      await db.delete(siteLocation).where(eq(siteLocation.id, loc));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("deleteBulk skips departments with live work areas, deletes the rest", async () => {
    const siteA = randomUUID();
    const loc = randomUUID();
    const free = randomUUID();
    const waBound = randomUUID();
    const wa = randomUUID();
    const hoActor = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t4-dept-wa-b-${siteA}` }]);
      await db.insert(siteLocation).values([
        { id: loc, siteId: siteA, name: "T4 Users Loc B" },
      ]);
      await db.insert(department).values([
        departmentRow(free, siteA, "T4 Dept WA Free"),
        departmentRow(waBound, siteA, "T4 Dept WA Bound"),
      ]);
      await db.insert(workArea).values([
        {
          id: wa,
          departmentId: waBound,
          siteLocationId: loc,
          siteId: siteA,
          name: "T4 Dept WA Bound Area",
        },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T4 Actor HO",
          email: `t4-dept-wa-b-${hoActor}@shiftly.test`,
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Actor HO",
        email: `t4-dept-wa-b-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };

      const { deleteBulk } = await import("./actions");
      const result = await deleteBulk([free, waBound]);

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(1);
      expect(result.blocked).toBe(1);
      expect(result.message).toContain(
        "Work areas still exist under this department",
      );

      const rows = await db
        .select({ id: department.id, deletedAt: department.deletedAt })
        .from(department);
      const freeRow = rows.find((row) => row.id === free);
      expect(freeRow).toBeDefined();
      expect(freeRow?.deletedAt).not.toBeNull();
      expect(rows.find((row) => row.id === waBound)?.deletedAt).toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(workArea).where(eq(workArea.id, wa));
      await db.delete(department).where(eq(department.id, free));
      await db.delete(department).where(eq(department.id, waBound));
      await db.delete(siteLocation).where(eq(siteLocation.id, loc));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("an unbound ho (siteId null) mutates nothing, fail closed", async () => {
    const siteA = randomUUID();
    const deptA = randomUUID();
    const hoActor = randomUUID();

    try {
      await db.insert(site).values([{ id: siteA, name: `t4-dept-ub-${siteA}` }]);
      await db.insert(department).values([departmentRow(deptA, siteA, "T4 Dept UB")]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T4 Unbound HO",
          email: `t4-dept-${hoActor}@shiftly.test`,
          emailVerified: true,
          role: "ho",
        },
      ]);

      actor = {
        id: hoActor,
        name: "T4 Unbound HO",
        email: `t4-dept-${hoActor}@shiftly.test`,
        role: "ho",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const { setActiveBulk, deleteBulk } = await import("./actions");
      const active = await setActiveBulk([deptA], false);
      expect(active.ok).toBe(true);
      expect(active.applied).toBe(0);

      const removed = await deleteBulk([deptA]);
      expect(removed.ok).toBe(true);
      expect(removed.applied).toBe(0);
      expect(removed.blocked).toBe(0);

      const rows = await db.select({ id: department.id }).from(department);
      expect(rows.find((row) => row.id === deptA)).toBeDefined();
      const [stateRow] = await db
        .select({ deletedAt: department.deletedAt })
        .from(department)
        .where(eq(department.id, deptA));
      expect(stateRow?.deletedAt).toBeNull();
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(department).where(eq(department.id, deptA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });
});
