import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";

import {
  deleteUserSessions,
  setCredentialPassword,
} from "./credential-store";
import { auth } from "./auth";
import { db } from "./db";
import { account, session, user } from "../drizzle/schema";

const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "new-password-456";
const TEST_EMAIL = "credential-store-test@shiftly.test";

// Creates a user + credential account the same way HO provisioning does
// (seed-script style), so the test verifies the real storage shape Better
// Auth's sign-in path reads.
async function createUserWithCredential({
  extraAccount,
}: { extraAccount?: boolean } = {}) {
  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    name: "Credential Store Test",
    email: TEST_EMAIL,
    emailVerified: true,
    role: "admin",
    isActive: true,
  });
  await db.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(OLD_PASSWORD),
  });
  if (extraAccount) {
    // A non-credential account row that resetPassword must leave untouched.
    await db.insert(account).values({
      id: randomUUID(),
      accountId: "some-oauth-account-id",
      providerId: "oauth2",
      userId,
      accessToken: "access-token-placeholder",
    });
  }
  return userId;
}

async function cleanup() {
  // Cascades to account (`account_userId_fk` onDelete cascade) and session.
  await db.delete(user).where(eq(user.email, TEST_EMAIL));
}

async function credentialPasswordHash(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ password: account.password })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    )
    .limit(1);
  return row?.password ?? null;
}

// Inserts future-dated session rows directly (sign-in would only make one),
// mirroring what several live devices look like on the eve of a reset.
async function insertSessions(userId: string, count: number): Promise<void> {
  await db.insert(session).values(
    Array.from({ length: count }, () => ({
      id: randomUUID(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      token: randomBytes(16).toString("hex"),
      userId,
    })),
  );
}

describe("credential store", () => {
  test("resetPassword: stored hash verifies true for the new password, false for the old", async () => {
    await cleanup();
    const userId = await createUserWithCredential({ extraAccount: true });

    // Sanity: the original hash verifies the old password.
    const initialHash = await credentialPasswordHash(userId);
    expect(initialHash).toBeTruthy();
    expect(await verifyPassword({ hash: initialHash!, password: OLD_PASSWORD })).toBe(true);

    const updated = await setCredentialPassword(userId, NEW_PASSWORD);
    expect(updated).toBe(1);

    const newHash = await credentialPasswordHash(userId);
    expect(newHash).toBeTruthy();
    expect(await verifyPassword({ hash: newHash!, password: NEW_PASSWORD })).toBe(true);
    expect(await verifyPassword({ hash: newHash!, password: OLD_PASSWORD })).toBe(false);

    // Only the credential row changed; the other account rows are untouched.
    const otherRows = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "oauth2")));
    expect(otherRows.length).toBe(1);
    expect(otherRows[0].password).toBeNull();
    expect(otherRows[0].accessToken).toBe("access-token-placeholder");

    await cleanup();
  });

  test("resetPassword: sign-in works with the new password and rejects the old", async () => {
    await cleanup();
    const userId = await createUserWithCredential();
    await setCredentialPassword(userId, NEW_PASSWORD);

    const login = await auth.api.signInEmail({
      body: { email: TEST_EMAIL, password: NEW_PASSWORD },
    });
    expect(login?.token).toBeTruthy();

    // Old password must no longer authenticate.
    const failed = await auth.api
      .signInEmail({ body: { email: TEST_EMAIL, password: OLD_PASSWORD } })
      .then(() => ({ code: "signed-in" }))
      .catch((err: unknown) => ({
        code: (err as { status?: string }).status,
      }));
    expect(failed?.code).toBe("UNAUTHORIZED");
    await cleanup();
  });

  test("resetPassword: returns 0 for a user without a credential account", async () => {
    expect(await setCredentialPassword("no-such-user-id", NEW_PASSWORD)).toBe(0);
  });

  test("deleteUserSessions: wipes every session row of the target user", async () => {
    await cleanup();
    const userId = await createUserWithCredential();

    await auth.api.signInEmail({
      body: { email: TEST_EMAIL, password: OLD_PASSWORD },
    });
    const before = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(before.length).toBeGreaterThan(0);

    await deleteUserSessions(userId);

    const after = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(after.length).toBe(0);

    await cleanup();
  });
});

// The resetPassword flow (HO resets a password from the Users page) ends in
// deleteUserSessions — here against sessions inserted directly, so the wipe
// is proven without depending on how many sign-ins a test could stage.
describe("credential store: direct-inserted sessions", () => {
  test("resetPassword flow: two live sessions of the target are wiped", async () => {
    await cleanup();
    const userId = await createUserWithCredential();

    await insertSessions(userId, 2);
    const before = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(before.length).toBe(2);

    await deleteUserSessions(userId);

    const after = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(after.length).toBe(0);

    await cleanup();
  });
});
