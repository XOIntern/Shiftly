import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { auth } from "./auth";
import { db } from "./db";
import { account, user } from "../drizzle/schema";

const OLD_PASSWORD = "password-123456";
const NEW_PASSWORD = "rotated-password-654321";

// Provisions a user + credential account the same way HO provisioning does
// (seed-script style), since Better Auth sign-up is disabled in lib/auth.ts.
async function createUser(): Promise<string> {
  const userId = randomUUID();
  createdUserIds.push(userId);
  const passwordHash = await hashPassword(OLD_PASSWORD);
  await db.insert(user).values({
    id: userId,
    name: "Change Password Test",
    email: `change-password-${userId}@shiftly.test`,
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

// Every user a test provisions, removed after the test whether it passed or
// failed. Deleting the user cascades to its account and session rows.
const createdUserIds: string[] = [];
afterEach(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(user).where(inArray(user.id, createdUserIds));
  createdUserIds.length = 0;
});

type SignInResult = { token: string; headers: Headers } | null;

// The session cookie Better Auth mints on sign-in is the signed form
// (`token.hmac`), so capture it from the sign-in response headers instead of
// rebuilding it from the raw token.
async function signIn(userId: string, password: string): Promise<SignInResult> {
  const email = `change-password-${userId}@shiftly.test`;
  const result = await auth.api
    .signInEmail({
      body: { email, password },
      returnHeaders: true,
    })
    .then(({ response, headers }) => ({ response, headers, error: null as string | null }))
    .catch((err: unknown) => ({
      response: null,
      headers: null,
      error: (err as { status?: string }).status,
    }));
  if (result.error || !result.response || !result.headers) return null;

  const cookies = result.headers.getSetCookie();
  const sessionCookie = cookies
    .map((cookie) => cookie.split(";")[0])
    .find((cookie) => cookie.startsWith("better-auth.session_token="));
  if (!sessionCookie) return null;
  return {
    token: result.response.token,
    headers: new Headers({ cookie: sessionCookie }),
  };
}

describe("auth.api changePassword contract", () => {
  test("wrong current password rejects with body.code INVALID_PASSWORD", async () => {
    const userId = await createUser();
    const signedIn = await signIn(userId, OLD_PASSWORD);
    expect(signedIn?.headers).toBeTruthy();

    const result = await auth.api
      .changePassword({
        body: { newPassword: NEW_PASSWORD, currentPassword: "wrong-current-password" },
        headers: signedIn!.headers,
      })
      .then(() => ({ rejected: false, body: null as { code?: string } | null }))
      .catch((err: unknown) => ({
        rejected: true,
        body: (err as { body?: { code?: string } }).body ?? null,
      }));

    expect(result.rejected).toBe(true);
    expect(result.body?.code).toBe("INVALID_PASSWORD");
  });

  test("success rotates the credential: old password stops working, new one signs in", async () => {
    const userId = await createUser();
    const signedIn = await signIn(userId, OLD_PASSWORD);
    expect(signedIn?.headers).toBeTruthy();

    const changed = await auth.api.changePassword({
      body: { newPassword: NEW_PASSWORD, currentPassword: OLD_PASSWORD },
      headers: signedIn!.headers,
    });
    expect(changed.user.id).toBe(userId);

    // The OLD password no longer signs in...
    const oldPasswordSignIn = await signIn(userId, OLD_PASSWORD);
    expect(oldPasswordSignIn).toBeNull();

    // ...and the NEW password does.
    const newPasswordSignIn = await signIn(userId, NEW_PASSWORD);
    expect(newPasswordSignIn).toBeTruthy();
  });

  test("revokeOtherSessions: true resolves the other session's cookie to null, keeps the current one", async () => {
    const userId = await createUser();
    const currentSession = await signIn(userId, OLD_PASSWORD);
    const otherSession = await signIn(userId, OLD_PASSWORD);
    expect(currentSession?.headers).toBeTruthy();
    expect(otherSession?.headers).toBeTruthy();

    // deleteUserSessions deletes ALL sessions (including the current one) and
    // re-creates one for this request, so the surviving session is only
    // reachable through the fresh Set-Cookie on this response.
    const { response, headers } = await auth.api
      .changePassword({
        body: {
          currentPassword: OLD_PASSWORD,
          newPassword: NEW_PASSWORD,
          revokeOtherSessions: true,
        },
        headers: currentSession!.headers,
        returnHeaders: true,
      });
    expect(response.token).toBeTruthy();

    // The OTHER session's cookie no longer resolves...
    const otherGone = await auth.api.getSession({
      headers: otherSession!.headers,
    });
    expect(otherGone).toBeNull();

    // ...while the CURRENT session still does, via the fresh cookie.
    const freshCookie = headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .find((cookie) => cookie.startsWith("better-auth.session_token="));
    expect(freshCookie).toBeTruthy();
    const currentAlive = await auth.api.getSession({
      headers: new Headers({ cookie: freshCookie! }),
    });
    expect(currentAlive?.user.id).toBe(userId);
  });

  test("unauthenticated call (no headers) rejects with status UNAUTHORIZED", async () => {
    const result = await auth.api
      .changePassword({
        body: { newPassword: NEW_PASSWORD, currentPassword: OLD_PASSWORD },
      })
      .then(() => ({ rejected: false, status: null as string | null }))
      .catch((err: unknown) => ({
        rejected: true,
        status: (err as { status?: string }).status ?? null,
      }));

    expect(result.rejected).toBe(true);
    expect(result.status).toBe("UNAUTHORIZED");
  });
});
