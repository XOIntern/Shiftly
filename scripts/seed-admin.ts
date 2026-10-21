import "dotenv/config";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db } from "../lib/db";
import { account, user } from "../drizzle/schema";

export type SeedResult =
  | "created"
  | "exists"
  | "error-missing-env"
  | "error-weak-password";

export async function seedAdmin(env: {
  email: string;
  password: string;
}): Promise<SeedResult> {
  if (!env.email || !env.password) return "error-missing-env";
  if (env.password.length < 15) return "error-weak-password";

  // Normalize to lowercase so the unique email matches what Better Auth's
  // sign-in compares against (`email.toLowerCase()` in sign-in.mjs) even
  // when ADMIN_EMAIL comes in mixed case.
  const email = env.email.toLowerCase();
  const existing = await db.select().from(user).where(eq(user.email, email));
  if (existing.length > 0) return "exists";

  // `auth.api.signUpEmail` is disabled (disableSignUp: true in lib/auth.ts),
  // so bootstrap admins by replicating what Better Auth's sign-up route does:
  // a credential account linked to the user, with the password hashed in
  // Better Auth's storage format (`salt:hex-key`, scrypt N=16384 r=16 p=1
  // dkLen=64) via the same `hashPassword` Better Auth itself uses
  // (lib better-auth default: dist/context/create-context.mjs:183).
  const passwordHash = await hashPassword(env.password);
  const userId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: userId,
      name: "Admin",
      email,
      emailVerified: true,
      role: "superadmin",
      isActive: true,
    });
    await tx.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
    });
  });

  return "created";
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const outcome = await seedAdmin({
    email: process.env.ADMIN_EMAIL ?? "",
    password: process.env.ADMIN_PASSWORD ?? "",
  });

  if (outcome === "created")
    console.log(`✓ Admin created: ${process.env.ADMIN_EMAIL}`);
  else if (outcome === "exists")
    console.log(`• Admin already exists: ${process.env.ADMIN_EMAIL}`);
  else {
    console.error(`✗ seed-admin failed: ${outcome}`);
    process.exit(1);
  }
}
