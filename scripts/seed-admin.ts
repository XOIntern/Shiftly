import "dotenv/config";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth";
import { db } from "../lib/db";
import { user } from "../drizzle/schema";

export type SeedResult = "created" | "exists" | "error-missing-env" | "error-weak-password";

export async function seedAdmin(env: { email: string; password: string }): Promise<SeedResult> {
  if (!env.email || !env.password) return "error-missing-env";
  if (env.password.length < 8) return "error-weak-password";

  const existing = await db.select().from(user).where(eq(user.email, env.email));
  if (existing.length > 0) return "exists";

  const res = await auth.api.signUpEmail({
    body: { email: env.email, password: env.password, name: "Admin" },
  });
  if (!res) return "error-missing-env"; // user creation failed

  await db.update(user).set({ emailVerified: true }).where(eq(user.email, env.email));
  return "created";
}

if (import.meta.main) {
  const outcome = await seedAdmin({
    email: process.env.ADMIN_EMAIL ?? "",
    password: process.env.ADMIN_PASSWORD ?? "",
  });

  if (outcome === "created") console.log(`✓ Admin created: ${process.env.ADMIN_EMAIL}`);
  else if (outcome === "exists") console.log(`• Admin already exists: ${process.env.ADMIN_EMAIL}`);
  else {
    console.error(`✗ seed-admin failed: ${outcome}`);
    process.exit(1);
  }
}
