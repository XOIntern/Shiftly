import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { purgeUserGuarded } from "./user-purge";
import { account, session, user } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAttendance,
  seedAuditLog,
  seedLocation,
  seedMpRequest,
  seedRosterPlan,
  seedShift,
  seedSite,
  seedUser,
  seedWorkArea,
  seedWorker,
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

function purge(id: string) {
  return db.transaction((tx) => purgeUserGuarded(tx, id));
}

async function exists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, id));
  return rows.length === 1;
}

// A deleted admin with a credential account and a session, so a purge can
// prove both go with the user.
async function seedDeletedAdmin() {
  const site = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, site.id);
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: site.id,
    siteLocationId: loc.id,
    deleted: true,
  });
  const accountId = randomUUID();
  const sessionId = randomUUID();
  cleanup.defer(async () => {
    await db.delete(session).where(eq(session.id, sessionId));
    await db.delete(account).where(eq(account.id, accountId));
  });
  await db.insert(account).values({
    id: accountId,
    accountId: admin.id,
    providerId: "credential",
    userId: admin.id,
    password: "hash",
  });
  await db.insert(session).values({
    id: sessionId,
    token: `t193-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 60_000),
    userId: admin.id,
  });
  return { site, loc, admin };
}

async function authRows(userId: string) {
  return {
    accounts: (
      await db.select().from(account).where(eq(account.userId, userId))
    ).length,
    sessions: (
      await db.select().from(session).where(eq(session.userId, userId))
    ).length,
  };
}

const AUDIT = "User has audit history and cannot be permanently deleted";
const ROSTER = "User has roster history and cannot be permanently deleted";
const REQUEST = "User has request history and cannot be permanently deleted";
const ATTENDANCE =
  "User has attendance history and cannot be permanently deleted";

describe("purgeUserGuarded", () => {
  test("a user that is not soft-deleted is refused and kept", async () => {
    const live = await seedUser(cleanup, { role: "superadmin" });

    expect(await purge(live.id)).toEqual({
      ok: false,
      message: "Deleted user not found.",
    });
    expect(await exists(live.id)).toBe(true);
  });

  test("an unknown id is refused", async () => {
    expect(await purge(randomUUID())).toEqual({
      ok: false,
      message: "Deleted user not found.",
    });
  });

  test("a clean deleted user is removed with their sessions and accounts", async () => {
    const { admin } = await seedDeletedAdmin();
    expect(await authRows(admin.id)).toEqual({ accounts: 1, sessions: 1 });

    expect(await purge(admin.id)).toEqual({ ok: true });

    expect(await exists(admin.id)).toBe(false);
    expect(await authRows(admin.id)).toEqual({ accounts: 0, sessions: 0 });
  });

  test("a deleted superadmin and a deleted HO are purged the same way", async () => {
    const site = await seedSite(cleanup);
    const ho = await seedUser(cleanup, {
      role: "ho",
      siteId: site.id,
      deleted: true,
    });
    const superadmin = await seedUser(cleanup, {
      role: "superadmin",
      deleted: true,
    });

    expect(await purge(ho.id)).toEqual({ ok: true });
    expect(await purge(superadmin.id)).toEqual({ ok: true });
  });

  test("purging one user leaves another deleted user alone", async () => {
    const { admin } = await seedDeletedAdmin();
    const other = await seedDeletedAdmin();

    expect(await purge(admin.id)).toEqual({ ok: true });

    expect(await exists(other.admin.id)).toBe(true);
    expect(await authRows(other.admin.id)).toEqual({ accounts: 1, sessions: 1 });
  });

  test("an audit row the user authored is history: refused, and everything stays", async () => {
    const { admin } = await seedDeletedAdmin();
    await seedAuditLog(cleanup, { actorId: admin.id });

    expect(await purge(admin.id)).toEqual({ ok: false, message: AUDIT });
    expect(await exists(admin.id)).toBe(true);
    expect(await authRows(admin.id)).toEqual({ accounts: 1, sessions: 1 });
  });

  test("a roster plan the user generated is history", async () => {
    const { loc, admin } = await seedDeletedAdmin();
    await seedRosterPlan(cleanup, loc, { generatedBy: admin.id });

    expect(await purge(admin.id)).toEqual({ ok: false, message: ROSTER });
    expect(await exists(admin.id)).toBe(true);
  });

  test("a roster plan the user published is history", async () => {
    const { loc, admin } = await seedDeletedAdmin();
    const author = await seedUser(cleanup, { role: "superadmin" });
    await seedRosterPlan(cleanup, loc, {
      generatedBy: author.id,
      publishedBy: admin.id,
    });

    expect(await purge(admin.id)).toEqual({ ok: false, message: ROSTER });
    expect(await exists(admin.id)).toBe(true);
  });

  test("a request the user created is history", async () => {
    const { loc, admin } = await seedDeletedAdmin();
    await seedMpRequest(cleanup, loc, { createdBy: admin.id });

    expect(await purge(admin.id)).toEqual({ ok: false, message: REQUEST });
    expect(await exists(admin.id)).toBe(true);
  });

  test("an attendance record the user recorded is history", async () => {
    const { loc, admin } = await seedDeletedAdmin();
    const w = await seedWorker(cleanup, loc);
    const shift = await seedShift(cleanup, loc);
    const area = await seedWorkArea(cleanup, loc);
    await seedAttendance(cleanup, {
      loc,
      workerId: w.id,
      workAreaId: area.id,
      shiftId: shift.id,
      recordedBy: admin.id,
    });

    expect(await purge(admin.id)).toEqual({ ok: false, message: ATTENDANCE });
    expect(await exists(admin.id)).toBe(true);
    expect(await authRows(admin.id)).toEqual({ accounts: 1, sessions: 1 });
  });

  test("history of another user does not block the purge", async () => {
    const { loc, admin } = await seedDeletedAdmin();
    const author = await seedUser(cleanup, { role: "superadmin" });
    await seedAuditLog(cleanup, { actorId: author.id, siteLocationId: loc.id });
    await seedMpRequest(cleanup, loc, { createdBy: author.id });

    expect(await purge(admin.id)).toEqual({ ok: true });
  });
});
