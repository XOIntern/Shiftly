import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { APIError } from "better-auth/api";

import { auth } from "./auth";
import { db } from "./db";
import { account, user } from "../drizzle/schema";
import { changePasswordErrorState } from "../app/(dashboard)/settings/actions";
import { GENERIC_ERROR } from "./action-state";

const OLD_PASSWORD = "password-123456";
const NEW_PASSWORD = "rotated-password-654321";

// Provisions a user + credential account the same way HO provisioning does
// (seed-script style), since Better Auth sign-up is disabled in lib/auth.ts.
async function createUser(): Promise<string> {
  const userId = randomUUID();
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

async function cleanup(userId: string) {
  // Cascades to account and session.
  await db.delete(user).where(eq(user.id, userId));
}

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

    await cleanup(userId);
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

    await cleanup(userId);
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

describe("changePasswordErrorState", () => {
  test("maps INVALID_PASSWORD to a currentPassword field error", () => {
    const err = new APIError("BAD_REQUEST", {
      message: "Invalid password",
      code: "INVALID_PASSWORD",
    });

    const result = changePasswordErrorState(err);

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({
      currentPassword: "Current password is incorrect.",
    });
    expect(result.message).toBeUndefined();
  });

  test("maps an unknown error code to the generic failure", () => {
    const err = new APIError("BAD_REQUEST", {
      message: "no account",
      code: "CREDENTIAL_ACCOUNT_NOT_FOUND",
    });

    const result = changePasswordErrorState(err);

    expect(result).toEqual({ ok: false, message: GENERIC_ERROR });
  });

  test("maps a non-APIError throw to the generic failure", () => {
    const result = changePasswordErrorState(new Error("boom"));

    expect(result).toEqual({ ok: false, message: GENERIC_ERROR });
  });

  test("maps a non-object throw to the generic failure", () => {
    const result = changePasswordErrorState("network down");

    expect(result).toEqual({ ok: false, message: GENERIC_ERROR });
  });
});
