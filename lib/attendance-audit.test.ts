import "dotenv/config";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { auditLog } from "../drizzle/schema";
import { db } from "./db";
import { installCleanup } from "./test-cleanup";
import { seedLocation, seedSite, seedUser } from "./test-fixtures";
import {
  ATTENDANCE_AUDIT_ACTIONS,
  recordAttendanceAudit,
} from "./attendance-audit";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

async function fixture() {
  const s = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, s.id);
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: s.id,
    siteLocationId: loc.id,
  });
  // Audit rows reference the actor: remove them before the user (teardowns
  // run newest first).
  cleanup.defer(async () => {
    await db.delete(auditLog).where(eq(auditLog.actorId, admin.id));
  });
  return { s, loc, admin };
}

describe("recordAttendanceAudit", () => {
  test("the three audited attendance actions", () => {
    expect([...ATTENDANCE_AUDIT_ACTIONS]).toEqual([
      "attendance.correct",
      "attendance.unscheduled.add",
      "attendance.unscheduled.remove",
    ]);
  });

  test("writes one audit row with the actor, location and details", async () => {
    const { s, loc, admin } = await fixture();

    await db.transaction((tx) =>
      recordAttendanceAudit(tx, {
        actorId: admin.id,
        action: "attendance.correct",
        siteId: s.id,
        siteLocationId: loc.id,
        details: { reason: "typo", old: { status: "present" } },
      }),
    );

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorId, admin.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("attendance.correct");
    expect(rows[0].siteId).toBe(s.id);
    expect(rows[0].siteLocationId).toBe(loc.id);
    expect(rows[0].details).toEqual({
      reason: "typo",
      old: { status: "present" },
    });
  });

  test("a rolled-back transaction leaves no audit row behind", async () => {
    const { s, loc, admin } = await fixture();

    await expect(
      db.transaction(async (tx) => {
        await recordAttendanceAudit(tx, {
          actorId: admin.id,
          action: "attendance.unscheduled.add",
          siteId: s.id,
          siteLocationId: loc.id,
          details: {},
        });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(
      await db.select().from(auditLog).where(eq(auditLog.actorId, admin.id)),
    ).toHaveLength(0);
  });
});
