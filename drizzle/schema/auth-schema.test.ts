import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { site } from "./site-schema";
import {
  account,
  session,
  user,
  verification,
} from "./auth-schema";

// DB-level pins for the Better Auth tables as Shiftly extends them: the
// text PKs, the user_role enum, the partial unique on live emails
// (deleted_at is null) that makes emails reusable after soft delete, the
// restrict FKs from user to site/site_location, and the cascades from
// user to session/account. Fixtures are prefixed t-auth- and cleaned up
// after each run.

let fixtureSeq = 0;
const nextSeq = () => `t${++fixtureSeq}`;

const createdSiteIds: string[] = [];
const createdUserIds: string[] = [];
const createdSessionIds: string[] = [];
const createdAccountIds: string[] = [];
const createdVerificationIds: string[] = [];

async function createSite(run: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-auth-${run}-site-${siteId}`,
  });
  return siteId;
}

interface UserArgs {
  email?: string;
  role?: "superadmin" | "ho" | "admin";
  siteId?: string;
  siteLocationId?: string;
}

async function createUser(
  run: string,
  args: UserArgs = {},
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  createdUserIds.push(id);
  const email = args.email ?? `t-auth-${run}-${id}@shiftly.test`;
  await db.insert(user).values({
    id,
    name: `t-auth-${run}-user`,
    email,
    ...(args.role ? { role: args.role } : {}),
    ...(args.siteId ? { siteId: args.siteId } : {}),
    ...(args.siteLocationId ? { siteLocationId: args.siteLocationId } : {}),
  });
  return { id, email };
}

interface SessionArgs {
  userId: string;
  token?: string;
}

const HOUR_AHEAD = () => new Date(Date.now() + 60 * 60 * 1000);

async function createSession(
  args: SessionArgs,
  id = randomUUID(),
): Promise<string> {
  createdSessionIds.push(id);
  await db.insert(session).values({
    id,
    token: args.token ?? `t-auth-token-${id}`,
    expiresAt: HOUR_AHEAD(),
    userId: args.userId,
    // No column default: Better Auth supplies updated_at on write.
    updatedAt: new Date(),
  });
  return id;
}

async function createCredentialAccount(
  userId: string,
  id = randomUUID(),
): Promise<string> {
  createdAccountIds.push(id);
  await db.insert(account).values({
    id,
    accountId: userId,
    providerId: "credential",
    userId,
    password: `t-auth-hash-${id}`,
    updatedAt: new Date(),
  });
  return id;
}

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await db.delete(session).where(inArray(session.id, createdSessionIds));
  }
  if (createdAccountIds.length > 0) {
    await db.delete(account).where(inArray(account.id, createdAccountIds));
  }
  if (createdVerificationIds.length > 0) {
    await db.delete(verification).where(
      inArray(verification.id, createdVerificationIds),
    );
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
  }
  if (createdSiteIds.length > 0) {
    await db.delete(site).where(inArray(site.id, createdSiteIds));
  }
});

describe("user (Better Auth + Shiftly roles)", () => {
  test("t-auth-anchor: insert with defaults round-trips", async () => {
    const run = nextSeq();
    const { id, email } = await createUser(run);

    const [row] = await db.select().from(user).where(eq(user.id, id));
    expect(row).toBeTruthy();
    expect(row.id).toBe(id);
    expect(row.email).toBe(email);
    expect(row.role).toBe("admin");
    expect(row.emailVerified).toBe(false);
    expect(row.isActive).toBe(true);
    expect(row.siteId).toBeNull();
    expect(row.siteLocationId).toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  test("accepts an explicit superadmin role", async () => {
    const run = nextSeq();
    const { id } = await createUser(run, { role: "superadmin" });

    const [row] = await db.select().from(user).where(eq(user.id, id));
    expect(row.role).toBe("superadmin");
  });

  test("unknown role value: rejected with 22P02", async () => {
    const run = nextSeq();
    const userId = randomUUID();
    createdUserIds.push(userId);

    let code: string | undefined;
    try {
      await db.insert(user).values({
        id: userId,
        name: `t-auth-${run}-user`,
        email: `t-auth-${run}-${userId}@shiftly.test`,
        role: "manager" as never,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("22P02");
    expect(
      (await db.select().from(user).where(eq(user.id, userId))).length,
    ).toBe(0);
  });

  test("duplicate live email: rejected with 23505", async () => {
    const run = nextSeq();
    const first = await createUser(run);
    const dupeId = randomUUID();
    createdUserIds.push(dupeId);

    let code: string | undefined;
    try {
      await db.insert(user).values({
        id: dupeId,
        name: `t-auth-${run}-dupe`,
        email: first.email,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(user).where(eq(user.id, dupeId))).length,
    ).toBe(0);
  });

  test("a soft-deleted user's email becomes reusable", async () => {
    const run = nextSeq();
    const retired = await createUser(run);
    await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(eq(user.id, retired.id));

    const reused = await createUser(run, { email: retired.email });
    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, reused.id));
    expect(row).toBeTruthy();
    expect(row.email).toBe(retired.email);
    expect(row.deletedAt).toBeNull();
  });

  test("a live email is still unique against a deleted row's email", async () => {
    const run = nextSeq();
    const live = await createUser(run);
    const deleted = await createUser(run);
    await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(eq(user.id, deleted.id));

    // The deleted row is outside the index, so it must NOT block the live
    // user; colliding with the LIVE user must still fail.
    let code: string | undefined;
    const latecomerId = randomUUID();
    createdUserIds.push(latecomerId);
    try {
      await db.insert(user).values({
        id: latecomerId,
        name: `t-auth-${run}-late`,
        email: live.email,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
  });

  test("unknown siteId: rejected with 23503", async () => {
    const run = nextSeq();
    const userId = randomUUID();
    createdUserIds.push(userId);

    let code: string | undefined;
    try {
      await db.insert(user).values({
        id: userId,
        name: `t-auth-${run}-user`,
        email: `t-auth-${run}-${userId}@shiftly.test`,
        siteId: randomUUID(),
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(user).where(eq(user.id, userId))).length,
    ).toBe(0);
  });

  test("deleting the referenced site is restricted while a user binds it: 23001", async () => {
    const run = nextSeq();
    const siteId = await createSite(run);
    await createUser(run, { siteId });

    let code: string | undefined;
    try {
      await db.delete(site).where(eq(site.id, siteId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23001");
    expect(
      (await db.select().from(site).where(eq(site.id, siteId))).length,
    ).toBe(1);
  });
});

describe("session", () => {
  test("t-auth-anchor: happy path inserts and round-trips", async () => {
    const run = nextSeq();
    const { id: userId } = await createUser(run);
    const expiresAt = HOUR_AHEAD();
    const sessionId = randomUUID();
    createdSessionIds.push(sessionId);

    await db.insert(session).values({
      id: sessionId,
      token: `t-auth-token-${sessionId}`,
      expiresAt,
      userId,
      ipAddress: "127.0.0.1",
      userAgent: "bun-test",
      updatedAt: new Date(),
    });

    const [row] = await db
      .select()
      .from(session)
      .where(eq(session.id, sessionId));
    expect(row).toBeTruthy();
    expect(row.userId).toBe(userId);
    expect(row.token).toBe(`t-auth-token-${sessionId}`);
    expect(row.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(row.ipAddress).toBe("127.0.0.1");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("duplicate token: rejected with 23505", async () => {
    const run = nextSeq();
    const { id: userId } = await createUser(run);
    const token = `t-auth-token-dup-${run}`;
    await createSession({ userId, token });

    const dupeId = randomUUID();
    createdSessionIds.push(dupeId);
    let code: string | undefined;
    try {
      await db.insert(session).values({
        id: dupeId,
        token,
        expiresAt: HOUR_AHEAD(),
        userId,
        updatedAt: new Date(),
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(session).where(eq(session.id, dupeId))).length,
    ).toBe(0);
  });

  test("missing userId: rejected with 23502", async () => {
    const sessionId = randomUUID();
    createdSessionIds.push(sessionId);

    let code: string | undefined;
    try {
      await db.insert(session).values({
        id: sessionId,
        token: `t-auth-token-${sessionId}`,
        expiresAt: HOUR_AHEAD(),
        userId: undefined as never,
        updatedAt: new Date(),
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(session).where(eq(session.id, sessionId)))
        .length,
    ).toBe(0);
  });

  test("deleting the user cascades to their sessions; other users' survive", async () => {
    const run = nextSeq();
    const survivor = await createUser(run);
    const gone = await createUser(run);
    const survivorSessionId = await createSession({ userId: survivor.id });
    const goneSessionId = await createSession({ userId: gone.id });

    await db.delete(user).where(eq(user.id, gone.id));
    expect(
      (await db.select().from(session).where(eq(session.id, goneSessionId)))
        .length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(session)
          .where(eq(session.id, survivorSessionId))
      ).length,
    ).toBe(1);
  });
});

describe("account", () => {
  test("t-auth-anchor: credential account inserts and round-trips", async () => {
    const run = nextSeq();
    const { id: userId } = await createUser(run);
    const accountId = await createCredentialAccount(userId);

    const [row] = await db
      .select()
      .from(account)
      .where(eq(account.id, accountId));
    expect(row).toBeTruthy();
    expect(row.userId).toBe(userId);
    expect(row.providerId).toBe("credential");
    expect(row.accountId).toBe(userId);
    expect(row.password).toBeTruthy();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("deleting the user cascades to their accounts; other users' survive", async () => {
    const run = nextSeq();
    const survivor = await createUser(run);
    const gone = await createUser(run);
    const survivorAccountId = await createCredentialAccount(survivor.id);
    const goneAccountId = await createCredentialAccount(gone.id);

    await db.delete(user).where(eq(user.id, gone.id));
    expect(
      (await db.select().from(account).where(eq(account.id, goneAccountId)))
        .length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(account)
          .where(eq(account.id, survivorAccountId))
      ).length,
    ).toBe(1);
  });
});

describe("verification", () => {
  test("t-auth-anchor: inserts with column defaults", async () => {
    const verificationId = randomUUID();
    createdVerificationIds.push(verificationId);

    await db.insert(verification).values({
      id: verificationId,
      identifier: `t-auth-${verificationId}@shiftly.test`,
      value: `t-auth-value-${verificationId}`,
      expiresAt: HOUR_AHEAD(),
    });

    const [row] = await db
      .select()
      .from(verification)
      .where(eq(verification.id, verificationId));
    expect(row).toBeTruthy();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });
});
