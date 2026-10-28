import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { restoreUserGuarded } from "./user-restore";
import { account, session, user } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";
import { seedLocation, seedSite, seedUser } from "@/lib/test-fixtures";
import type { ScopeActor } from "@/types/session";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

const SUPERADMIN: ScopeActor = {
  role: "superadmin",
  siteId: null,
  siteLocationId: null,
};

function hoOf(siteId: string | null): ScopeActor {
  return { role: "ho", siteId, siteLocationId: null };
}

async function rowOf(id: string) {
  const [row] = await db
    .select({ deletedAt: user.deletedAt, isActive: user.isActive })
    .from(user)
    .where(eq(user.id, id));
  return row;
}

function restore(actor: ScopeActor, id: string) {
  return db.transaction((tx) => restoreUserGuarded(tx, actor, id));
}

const NOT_FOUND = { ok: false, message: "Deleted user not found." };

// A deleted admin bound to a fresh location of a fresh site.
async function seedDeletedAdmin(opts: { locationDeleted?: boolean } = {}) {
  const site = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, site.id, {
    deleted: opts.locationDeleted,
  });
  const admin = await seedUser(cleanup, {
    role: "admin",
    siteId: site.id,
    siteLocationId: loc.id,
    deleted: true,
  });
  return { site, loc, admin };
}

describe("restoreUserGuarded", () => {
  test("a superadmin restores a deleted admin, who comes back live", async () => {
    const { admin } = await seedDeletedAdmin();

    expect(await restore(SUPERADMIN, admin.id)).toEqual({ ok: true });

    expect(await rowOf(admin.id)).toEqual({ deletedAt: null, isActive: true });
  });

  test("an inactive user stays inactive when restored", async () => {
    const { admin } = await seedDeletedAdmin();
    await db.update(user).set({ isActive: false }).where(eq(user.id, admin.id));

    expect(await restore(SUPERADMIN, admin.id)).toEqual({ ok: true });

    expect(await rowOf(admin.id)).toEqual({ deletedAt: null, isActive: false });
  });

  test("credentials are untouched and no session is recreated", async () => {
    const { admin } = await seedDeletedAdmin();
    const accountId = randomUUID();
    cleanup.defer(async () => {
      await db.delete(account).where(eq(account.id, accountId));
    });
    await db.insert(account).values({
      id: accountId,
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: "hash-before",
    });

    expect(await restore(SUPERADMIN, admin.id)).toEqual({ ok: true });

    const [credential] = await db
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, admin.id));
    expect(credential.password).toBe("hash-before");
    expect(
      await db.select().from(session).where(eq(session.userId, admin.id)),
    ).toHaveLength(0);
  });

  test("a superadmin restores a deleted HO and a deleted superadmin", async () => {
    const site = await seedSite(cleanup);
    const ho = await seedUser(cleanup, {
      role: "ho",
      siteId: site.id,
      deleted: true,
    });
    const other = await seedUser(cleanup, { role: "superadmin", deleted: true });

    expect(await restore(SUPERADMIN, ho.id)).toEqual({ ok: true });
    expect(await restore(SUPERADMIN, other.id)).toEqual({ ok: true });
  });

  test("an HO restores a deleted admin of their own site's location", async () => {
    const { site, admin } = await seedDeletedAdmin();

    expect(await restore(hoOf(site.id), admin.id)).toEqual({ ok: true });
    expect((await rowOf(admin.id)).deletedAt).toBeNull();
  });

  test("an HO of another site gets not-found and the user stays deleted", async () => {
    const { admin } = await seedDeletedAdmin();
    const otherSite = await seedSite(cleanup);

    expect(await restore(hoOf(otherSite.id), admin.id)).toEqual(NOT_FOUND);
    expect((await rowOf(admin.id)).deletedAt).not.toBeNull();
  });

  test("an HO bound to no site restores nothing", async () => {
    const { admin } = await seedDeletedAdmin();

    expect(await restore(hoOf(null), admin.id)).toEqual(NOT_FOUND);
  });

  test("an HO never restores a deleted HO or a deleted superadmin", async () => {
    const site = await seedSite(cleanup);
    const ho = await seedUser(cleanup, {
      role: "ho",
      siteId: site.id,
      deleted: true,
    });
    const other = await seedUser(cleanup, { role: "superadmin", deleted: true });

    expect(await restore(hoOf(site.id), ho.id)).toEqual(NOT_FOUND);
    expect(await restore(hoOf(site.id), other.id)).toEqual(NOT_FOUND);
    expect((await rowOf(ho.id)).deletedAt).not.toBeNull();
  });

  test("an admin actor restores nothing", async () => {
    const { site, loc, admin } = await seedDeletedAdmin();

    expect(
      await restore(
        { role: "admin", siteId: site.id, siteLocationId: loc.id },
        admin.id,
      ),
    ).toEqual(NOT_FOUND);
  });

  test("a user that is not soft-deleted is refused and left alone", async () => {
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    const live = await seedUser(cleanup, {
      role: "admin",
      siteId: site.id,
      siteLocationId: loc.id,
    });

    expect(await restore(SUPERADMIN, live.id)).toEqual(NOT_FOUND);
    expect((await rowOf(live.id)).deletedAt).toBeNull();
  });

  test("an unknown id is refused", async () => {
    expect(await restore(SUPERADMIN, randomUUID())).toEqual(NOT_FOUND);
  });

  test("an admin whose location is deleted refuses the restore, for an HO and a superadmin", async () => {
    const { site, admin } = await seedDeletedAdmin({ locationDeleted: true });
    const refused = {
      ok: false,
      message: "Location is deleted; restore it first",
    };

    expect(await restore(hoOf(site.id), admin.id)).toEqual(refused);
    expect(await restore(SUPERADMIN, admin.id)).toEqual(refused);
    expect((await rowOf(admin.id)).deletedAt).not.toBeNull();
  });

  test("an HO whose site is deleted refuses the restore", async () => {
    const site = await seedSite(cleanup, { deleted: true });
    const ho = await seedUser(cleanup, {
      role: "ho",
      siteId: site.id,
      deleted: true,
    });

    expect(await restore(SUPERADMIN, ho.id)).toEqual({
      ok: false,
      message: "Site is deleted; restore it first",
    });
    expect((await rowOf(ho.id)).deletedAt).not.toBeNull();
  });

  test("a live user already using the email refuses the restore", async () => {
    const email = `t193-clash-${randomUUID()}@shiftly.test`;
    const { site, loc } = await seedDeletedAdmin();
    const deleted = await seedUser(cleanup, {
      role: "admin",
      siteId: site.id,
      siteLocationId: loc.id,
      deleted: true,
      email,
    });
    await seedUser(cleanup, { role: "superadmin", email });

    expect(await restore(SUPERADMIN, deleted.id)).toEqual({
      ok: false,
      message: "Email already in use",
    });
    expect((await rowOf(deleted.id)).deletedAt).not.toBeNull();
  });

  test("another deleted user with the same email does not block the restore", async () => {
    const email = `t193-twin-${randomUUID()}@shiftly.test`;
    const { site, loc } = await seedDeletedAdmin();
    const a = await seedUser(cleanup, {
      role: "admin",
      siteId: site.id,
      siteLocationId: loc.id,
      deleted: true,
      email,
    });
    const b = await seedUser(cleanup, {
      role: "admin",
      siteId: site.id,
      siteLocationId: loc.id,
      deleted: true,
      email,
    });

    expect(await restore(SUPERADMIN, a.id)).toEqual({ ok: true });
    expect((await rowOf(b.id)).deletedAt).not.toBeNull();
  });
});
