import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { auth } from "./auth";
import { db } from "./db";
import { account, session, user } from "../drizzle/schema";

const PASSWORD = "password-123456";

// Provisions a user + credential account the same way HO provisioning does
// (seed-script style), since Better Auth sign-up is disabled in lib/auth.ts.
async function createUser(
  email?: string,
  password: string = PASSWORD,
): Promise<string> {
  const userId = randomUUID();
  const passwordHash = await hashPassword(password);
  await db.insert(user).values({
    id: userId,
    name: "Deleted User Auth Test",
    email: email ?? `deleted-user-${userId}@shiftly.test`,
    emailVerified: true,
    role: "admin",
    isActive: true,
  });
  await db.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: passwordHash,
  });
  return userId;
}

async function cleanup(userId: string) {
  // Cascades to account and session.
  await db.delete(user).where(eq(user.id, userId));
}

describe("soft-deleted user auth", () => {
  test("sign-in for a soft-deleted user is refused with FORBIDDEN and mints no session", async () => {
    const userId = await createUser();

    // Soft-delete directly: the deleteUser action does not exist yet, and
    // isActive deliberately stays true — deletion alone must be enough.
    await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(eq(user.id, userId));

    let status: string | undefined;
    let message: string | undefined;
    try {
      await auth.api.signInEmail({
        body: {
          email: `deleted-user-${userId}@shiftly.test`,
          password: PASSWORD,
        },
      });
    } catch (err) {
      status = (err as { status?: string }).status;
      message = (err as { body?: { message?: string } }).body?.message;
    }

    expect(status).toBe("FORBIDDEN");
    // Same generic message as the inactive branch — the error must not leak
    // that the account is deleted as opposed to inactive.
    expect(message).toBe("Your account is inactive.");

    // The refusal must happen before any session row is minted.
    const minted = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(minted).toHaveLength(0);

    await cleanup(userId);
  });

  test("sign-in resolves the live user when a deleted row shared the email", async () => {
    // The whole point of the partial unique index: once the old row is
    // soft-deleted, its email must be re-provisionable — and sign-in must
    // bind to the NEW account, never the deleted one.
    const reusedEmail = `reused-${randomUUID()}@shiftly.test`;
    const deletedId = await createUser(reusedEmail);

    // Soft-delete directly (same as the previous test): isActive stays true,
    // deletion alone must make the row invisible to sign-in resolution.
    await db
      .update(user)
      .set({ deletedAt: new Date() })
      .where(eq(user.id, deletedId));

    // A different password proves the credential check ran against the NEW
    // account: resolving the deleted row would fail with "Invalid password"
    // instead of minting a session for the live user.
    const livePassword = "reused-email-456789";
    const liveId = await createUser(reusedEmail, livePassword);
    const result = await auth.api.signInEmail({
      body: { email: reusedEmail, password: livePassword },
    });

    expect(result.user.id).toBe(liveId);

    // Exactly one live session exists, and it is the new user's.
    const sessions = await db
      .select({ id: session.id, userId: session.userId })
      .from(session)
      .where(eq(session.userId, liveId));
    expect(sessions).toHaveLength(1);
    const deletedSessions = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, deletedId));
    expect(deletedSessions).toHaveLength(0);

    await cleanup(liveId);
    await cleanup(deletedId);
  });
});
