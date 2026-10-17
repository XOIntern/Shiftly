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
async function createUser(): Promise<string> {
  const userId = randomUUID();
  const passwordHash = await hashPassword(PASSWORD);
  await db.insert(user).values({
    id: userId,
    name: "Deleted User Auth Test",
    email: `deleted-user-${userId}@shiftly.test`,
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
});
