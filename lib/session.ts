import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/drizzle/schema";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "ho" | "site_admin";
  siteId: string | null;
  isActive: boolean;
};

export async function getUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  // Role/site/isActive are read fresh from the DB on every request —
  // the session snapshot is stale once an HO edits a user's role or site.
  const [row] = await db
    .select({ role: user.role, siteId: user.siteId, isActive: user.isActive })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (!row) return null;

  if (row.isActive === false) {
    await auth.api.signOut({ headers: await headers() });
    return null;
  }

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: row.role,
    siteId: row.siteId,
    isActive: row.isActive,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireHO(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ho") redirect("/dashboard");
  return user;
}
