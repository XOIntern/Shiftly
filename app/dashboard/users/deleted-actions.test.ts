import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedAuditLog,
  seedLocation,
  seedSite,
  seedUser,
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

// The actions resolve their actor through requireHO (HO and superadmin pass,
// an admin does not) and requireSuperadmin (permanent delete). The stubs keep
// the real contracts' shape: the real ones redirect, which throws. The mock
// swaps the WHOLE module across bun's single test process, so every export
// other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => {
    if (actor.role === "admin") throw new Error("NEXT_REDIRECT");
    return actor;
  },
  requireSuperadmin: async () => {
    if (actor.role !== "superadmin") throw new Error("NEXT_REDIRECT");
    return actor;
  },
}));
// No Next request context under bun test. Real exports kept (module mocks are
// process-wide); only revalidatePath is replaced.
const realNextCache = { ...(await import("next/cache")) };
const revalidated: string[] = [];
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

function actorOf(
  role: SessionUser["role"],
  siteId: string | null = null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T193 Actor",
    email: `t193-actor-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId: null,
    isActive: true,
  };
}

async function stateOf(id: string): Promise<"missing" | "deleted" | "live"> {
  const [row] = await db
    .select({ deletedAt: user.deletedAt })
    .from(user)
    .where(eq(user.id, id));
  if (!row) return "missing";
  return row.deletedAt ? "deleted" : "live";
}

// A deleted admin of a fresh site's fresh location.
async function seedDeletedAdmin(opts: { email?: string } = {}) {
  const site = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, site.id);
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: site.id,
    siteLocationId: loc.id,
    deleted: true,
    email: opts.email,
  });
  return { site, loc, admin };
}

// A deleted admin the purge must refuse: they authored an audit row.
async function seedAdminWithHistory(): Promise<string> {
  const { admin } = await seedDeletedAdmin();
  await seedAuditLog(cleanup, { actorId: admin.id });
  return admin.id;
}

describe("restoreUser", () => {
  test("a superadmin brings a deleted user back and revalidates the list", async () => {
    const { admin } = await seedDeletedAdmin();
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreUser } = await import("./actions");

    expect(await restoreUser(admin.id)).toEqual({ ok: true });
    expect(await stateOf(admin.id)).toBe("live");
    expect(revalidated).toContain("/dashboard/users");
  });

  test("an HO restores a deleted admin of their own site's location", async () => {
    const { site, admin } = await seedDeletedAdmin();
    actor = actorOf("ho", site.id);

    const { restoreUser } = await import("./actions");

    expect(await restoreUser(admin.id)).toEqual({ ok: true });
  });

  test("an HO never restores another site's admin, a deleted HO or a deleted superadmin", async () => {
    const own = await seedDeletedAdmin();
    const foreign = await seedDeletedAdmin();
    const ho = await seedUser(cleanup, {
      role: "ho",
      siteId: own.site.id,
      deleted: true,
    });
    const superadmin = await seedUser(cleanup, {
      role: "superadmin",
      deleted: true,
    });
    actor = actorOf("ho", own.site.id);

    const { restoreUser } = await import("./actions");

    for (const target of [foreign.admin, ho, superadmin]) {
      expect(await restoreUser(target.id)).toEqual({
        ok: false,
        message: "Deleted user not found.",
      });
      expect(await stateOf(target.id)).toBe("deleted");
    }
  });

  test("an admin is turned away", async () => {
    const { site, admin } = await seedDeletedAdmin();
    actor = actorOf("admin", site.id);

    const { restoreUser } = await import("./actions");

    await expect(restoreUser(admin.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(admin.id)).toBe("deleted");
  });

  test("a taken email is refused with the email message", async () => {
    const email = `t193-clash-${randomUUID()}@shiftly.test`;
    const { admin } = await seedDeletedAdmin({ email });
    await seedUser(cleanup, { role: "superadmin", email });
    actor = actorOf("superadmin");

    const { restoreUser } = await import("./actions");

    expect(await restoreUser(admin.id)).toEqual({
      ok: false,
      message: "Email already in use",
    });
    expect(await stateOf(admin.id)).toBe("deleted");
  });

  test("an empty id is rejected", async () => {
    actor = actorOf("superadmin");

    const { restoreUser } = await import("./actions");

    expect(await restoreUser("")).toEqual({
      ok: false,
      message: "Invalid user id.",
    });
  });

  test("an id that is not a uuid is a normal lookup, since user ids are text", async () => {
    actor = actorOf("superadmin");

    const { restoreUser } = await import("./actions");

    expect(await restoreUser("not-a-uuid-but-text")).toEqual({
      ok: false,
      message: "Deleted user not found.",
    });
  });
});

describe("restoreUserBulk", () => {
  test("restores what it can and reports the rest as skipped", async () => {
    const email = `t193-bulk-clash-${randomUUID()}@shiftly.test`;
    const a = await seedDeletedAdmin();
    const b = await seedDeletedAdmin();
    const clash = await seedDeletedAdmin({ email });
    await seedUser(cleanup, { role: "superadmin", email });
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { restoreUserBulk } = await import("./actions");
    const result = await restoreUserBulk([a.admin.id, b.admin.id, clash.admin.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe("1 user skipped: Email already in use");
    expect(await stateOf(clash.admin.id)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/users");
  });

  test("an HO's batch never reaches another site's rows", async () => {
    const own = await seedDeletedAdmin();
    const foreign = await seedDeletedAdmin();
    actor = actorOf("ho", own.site.id);

    const { restoreUserBulk } = await import("./actions");
    const result = await restoreUserBulk([own.admin.id, foreign.admin.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(await stateOf(own.admin.id)).toBe("live");
    expect(await stateOf(foreign.admin.id)).toBe("deleted");
  });

  test("empty and repeated ids are dropped; nothing valid is an error", async () => {
    const { admin } = await seedDeletedAdmin();
    actor = actorOf("superadmin");

    const { restoreUserBulk } = await import("./actions");
    const result = await restoreUserBulk([admin.id, admin.id, ""]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(await restoreUserBulk([])).toEqual({
      ok: false,
      message: "No users selected.",
    });
    expect(await restoreUserBulk([""])).toEqual({
      ok: false,
      message: "No users selected.",
    });
  });

  test("an admin is turned away", async () => {
    const { site, admin } = await seedDeletedAdmin();
    actor = actorOf("admin", site.id);

    const { restoreUserBulk } = await import("./actions");

    await expect(restoreUserBulk([admin.id])).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("purgeUser", () => {
  test("a superadmin deletes a clean deleted user for good", async () => {
    const { admin } = await seedDeletedAdmin();
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeUser } = await import("./actions");

    expect(await purgeUser(admin.id)).toEqual({ ok: true });
    expect(await stateOf(admin.id)).toBe("missing");
    expect(revalidated).toContain("/dashboard/users");
  });

  test("a user with audit history is refused and kept", async () => {
    const id = await seedAdminWithHistory();
    actor = actorOf("superadmin");

    const { purgeUser } = await import("./actions");

    expect(await purgeUser(id)).toEqual({
      ok: false,
      message: "User has audit history and cannot be permanently deleted",
    });
    expect(await stateOf(id)).toBe("deleted");
  });

  test("an empty id is rejected", async () => {
    actor = actorOf("superadmin");

    const { purgeUser } = await import("./actions");

    expect(await purgeUser("")).toEqual({
      ok: false,
      message: "Invalid user id.",
    });
  });

  test("an HO is turned away, even for their own site's admin", async () => {
    const { site, admin } = await seedDeletedAdmin();
    actor = actorOf("ho", site.id);

    const { purgeUser } = await import("./actions");

    await expect(purgeUser(admin.id)).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(admin.id)).toBe("deleted");
  });
});

describe("purgeUserBulk", () => {
  test("deletes what it can and reports history-bound users as skipped", async () => {
    const a = await seedDeletedAdmin();
    const b = await seedDeletedAdmin();
    const withHistory = await seedAdminWithHistory();
    actor = actorOf("superadmin");
    revalidated.length = 0;

    const { purgeUserBulk } = await import("./actions");
    const result = await purgeUserBulk([a.admin.id, withHistory, b.admin.id]);

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe(
      "1 user skipped: User has audit history and cannot be permanently deleted",
    );
    expect(await stateOf(a.admin.id)).toBe("missing");
    expect(await stateOf(withHistory)).toBe("deleted");
    expect(revalidated).toContain("/dashboard/users");
  });

  test("a live user in the selection is skipped, not deleted", async () => {
    const live = await seedUser(cleanup, { role: "superadmin" });
    const gone = await seedDeletedAdmin();
    actor = actorOf("superadmin");

    const { purgeUserBulk } = await import("./actions");
    const result = await purgeUserBulk([live.id, gone.admin.id]);

    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.message).toBe("1 user skipped: Deleted user not found.");
    expect(await stateOf(live.id)).toBe("live");
  });

  test("an HO is turned away", async () => {
    const { site, admin } = await seedDeletedAdmin();
    actor = actorOf("ho", site.id);

    const { purgeUserBulk } = await import("./actions");

    await expect(purgeUserBulk([admin.id])).rejects.toThrow("NEXT_REDIRECT");
    expect(await stateOf(admin.id)).toBe("deleted");
  });
});
