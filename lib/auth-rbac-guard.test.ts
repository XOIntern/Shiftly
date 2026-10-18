import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { auth } from "./auth";
import { db } from "./db";
import { deleteUserSessions } from "./credential-store";
import { account, session, user } from "../drizzle/schema";

const TEST_PASSWORD = "password-123456";

// Provisions a user + credential account the same way HO provisioning does
// (seed-script style), since Better Auth sign-up is disabled in lib/auth.ts.
async function createUser({ isActive }: { isActive: boolean }): Promise<string> {
  const userId = randomUUID();
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await db.insert(user).values({
    id: userId,
    name: "Auth Guard Test",
    email: `auth-guard-${userId}@shiftly.test`,
    emailVerified: true,
    role: "admin",
    isActive,
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
async function signIn(userId: string): Promise<SignInResult> {
  const email = `auth-guard-${userId}@shiftly.test`;
  const result = await auth.api
    .signInEmail({
      body: { email, password: TEST_PASSWORD },
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

async function sessionRowCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.length;
}

describe("auth rbac guards (final review C1 + I2)", () => {
  test("C1: update-user cannot set role or isActive from the session owner", async () => {
    const userId = await createUser({ isActive: true });
    const signedIn = await signIn(userId);
    expect(signedIn?.headers).toBeTruthy();

    // The guarded body — self-service promotion attempt (the reviewer's
    // vector: POST {role: 'ho'} to /api/auth/update-user). The cast mirrors
    // the raw HTTP body: with input: false the inferred client type no
    // longer includes `role`, which is the guard.
    const promoteBody = { role: "ho" } as unknown as { name?: string };
    const promoted = await auth.api
      .updateUser({
        body: promoteBody,
        headers: signedIn!.headers,
      })
      .then(() => ({ accepted: true, error: null as string | null }))
      .catch((err: unknown) => ({
        accepted: false,
        error: (err as { status?: string }).status,
      }));

    expect(promoted.accepted).toBe(false);
    expect(promoted.error).toBe("BAD_REQUEST");

    // The endpoint itself still works: an innocuous field updates fine.
    const renamed = await auth.api.updateUser({
      body: { name: "Renamed While Guarded" },
      headers: signedIn!.headers,
    });
    expect(renamed).toBeTruthy();

    // DB row is unchanged for the guarded fields; only the name changed.
    const [row] = await db.select().from(user).where(eq(user.id, userId));
    expect(row.role).toBe("admin");
    expect(row.isActive).toBe(true);
    expect(row.name).toBe("Renamed While Guarded");

    await cleanup(userId);
  });

  test("T3 audit: update-user cannot self-promote to superadmin with a location", async () => {
    const userId = await createUser({ isActive: true }); // role "admin"
    const signedIn = await signIn(userId);
    expect(signedIn?.headers).toBeTruthy();

    // The self-promotion vector the redesign hardens: a DB admin posting
    // {role: 'superadmin', siteLocationId:<uuid>} to /api/auth/update-user.
    // The cast mirrors the raw HTTP body: both fields are `input: false`,
    // so the inferred client type no longer includes them — that is the
    // guard.
    const promoteBody = {
      role: "superadmin",
      siteLocationId: randomUUID(),
    } as unknown as { name?: string };
    const promoted = await auth.api
      .updateUser({
        body: promoteBody,
        headers: signedIn!.headers,
      })
      .then(() => ({ accepted: true, error: null as string | null }))
      .catch((err: unknown) => ({
        accepted: false,
        error: (err as { status?: string }).status,
      }));

    expect(promoted.accepted).toBe(false);
    expect(promoted.error).toBe("BAD_REQUEST");

    // Fresh DB row still shows the original role and no binding.
    const [row] = await db.select().from(user).where(eq(user.id, userId));
    expect(row.role).toBe("admin");
    expect(row.siteLocationId).toBeNull();

    await cleanup(userId);
  });

  test("I2: sign-in for a deactivated user is refused and mints no session", async () => {
    const userId = await createUser({ isActive: false });
    expect(await signIn(userId)).toBeNull();
    expect(await sessionRowCount(userId)).toBe(0);
    await cleanup(userId);
  });

  test("I2: sign-in for a deactivated user reports the account as inactive", async () => {
    const userId = await createUser({ isActive: false });
    const email = `auth-guard-${userId}@shiftly.test`;
    const failure = await auth.api
      .signInEmail({ body: { email, password: TEST_PASSWORD } })
      .then(() => ({ message: "signed-in" }))
      .catch((err: unknown) => ({
        message: (err as { body?: { message?: string } }).body?.message ?? "",
      }));
    expect(failure.message).toBe("Your account is inactive.");
    await cleanup(userId);
  });

  test("I2: reactivation wipes stale minted tokens, then sign-in works", async () => {
    // Simulates the stale-token hazard: a session that predates
    // deactivation, plus the deactivate/reactivate steps setActive performs
    // (db set + deleteUserSessions in both directions).
    const userId = await createUser({ isActive: true });
    const oldSession = await signIn(userId);
    expect(oldSession?.headers).toBeTruthy();

    // Deactivate.
    await db.update(user).set({ isActive: false }).where(eq(user.id, userId));
    await deleteUserSessions(userId);
    // Any sign-in attempted during the inactive window is refused...
    expect(await signIn(userId)).toBeNull();

    // Reactivate (same levers as the setActive action).
    await db.update(user).set({ isActive: true }).where(eq(user.id, userId));
    await deleteUserSessions(userId);

    // The pre-deactivation cookie must not resurrect the session...
    const resurrected = await auth.api
      .getSession({ headers: oldSession!.headers })
      .catch(() => null);
    expect(resurrected?.session).toEqual(undefined);
    expect(await sessionRowCount(userId)).toBe(0);

    // ...and a fresh sign-in works after reactivation.
    const fresh = await signIn(userId);
    expect(fresh?.token).toBeTruthy();
    expect(await sessionRowCount(userId)).toBe(1);

    await cleanup(userId);
  });
});
