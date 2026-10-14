import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { auth } from "./auth";
import { db } from "./db";
import { account } from "../drizzle/schema";

// Credential storage that mirrors Better Auth's own account shape
// (providerId "credential", accountId = the user's id, password hashed in
// its `salt:hex-key` scrypt format via the same `hashPassword` export
// Better Auth's sign-in verifies against — node_modules/better-auth/dist/
// api/routes/sign-in.mjs:326-335 and dist/context/create-context.mjs:183).
// This is what lets HO provision users even though public sign-up is
// disabled (disableSignUp in lib/auth.ts).

// Resets a user's credential password in place. Other account rows (OAuth
// etc.) are untouched. Returns the number of account rows updated — 0 when
// the user has no credential account.
export async function setCredentialPassword(
  userId: string,
  newPassword: string,
): Promise<number> {
  const passwordHash = await hashPassword(newPassword);
  const updated = await db
    .update(account)
    .set({ password: passwordHash })
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    )
    .returning({ id: account.id });
  return updated.length;
}

// Wipes every Better Auth session of a user — used on deactivation so an
// active login dies immediately. Delegates to the internal adapter's
// deleteUserSessions (node_modules/better-auth/dist/db/internal-adapter.mjs:
// 503); without secondary storage it issues a DB-side delete of all session
// rows for the userId (getActiveSessionReferences returns [] at
// internal-adapter.mjs:75-79).
export async function deleteUserSessions(userId: string): Promise<void> {
  const { internalAdapter } = await auth.$context;
  await internalAdapter.deleteUserSessions(userId);
}
