import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/drizzle/schema";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
  isActive: boolean;
};

export async function getUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  // Role/site/siteLocation/isActive are read fresh from the DB on every
  // request — the session snapshot is stale once an HO edits a user's
  // role or site.
  const [row] = await db
    .select({
      role: user.role,
      siteId: user.siteId,
      siteLocationId: user.siteLocationId,
      isActive: user.isActive,
    })
    .from(user)
    // A soft-deleted user (GitHub #38) resolves to no user: the stale
    // session falls through to the signed-out null flow and /login —
    // never a 500.
    .where(and(eq(user.id, session.user.id), isNull(user.deletedAt)))
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
    siteLocationId: row.siteLocationId,
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
  // superadmin has access to everything.
  if (user.role !== "ho" && user.role !== "superadmin") redirect("/dashboard");
  return user;
}

export async function requireSuperadmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "superadmin") redirect("/dashboard");
  return user;
}
