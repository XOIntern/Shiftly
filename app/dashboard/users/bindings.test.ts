import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { eq, like, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import type { Role } from "@/types/domain";

// The create/update actions resolve their actor through requireHO — swapped
// for a stub so the real server actions read against the test database
// without a Next request context. Same shape as bulk-active.test.ts.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
// Real exports kept (revalidateTag, updateTag, … stay available to suites that
// run after this one: module mocks are process-wide); only revalidatePath is
// replaced, since there is no Next request context under bun test.
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

// Shared fixture: siteA (the ho actor's site) with one location. The rows
// live for the whole file — only the minted user targets are per-test and
// cleaned up individually.
const siteA = randomUUID();
const locA = randomUUID();
const hoActor = randomUUID();
const superActor = randomUUID();
const mkEmail = (id: string) => `t9-users-${id}@shiftly.test`;

const hoActorRow: SessionUser = {
  id: hoActor,
  name: "T9 Actor HO",
  email: mkEmail(hoActor),
  role: "ho",
  siteId: siteA,
  siteLocationId: null,
  isActive: true,
};

const superActorRow: SessionUser = {
  id: superActor,
  name: "T9 Actor Super",
  email: mkEmail(superActor),
  role: "superadmin",
  siteId: null,
  siteLocationId: null,
  isActive: true,
};

const trackedIds: string[] = [];
async function mintUser(fields: {
  role: Role;
  siteId?: string | null;
  siteLocationId?: string | null;
}) {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: "T9 Target",
    email: `t9-target-${id}@shiftly.test`,
    emailVerified: true,
    role: fields.role,
    siteId: fields.siteId ?? null,
    siteLocationId: fields.siteLocationId ?? null,
  });
  trackedIds.push(id);
  return id;
}

describe("users bindings (the user work-area binding is removed)", () => {
  beforeAll(async () => {
    await db.insert(site).values([
      { id: siteA, name: `t9-users-site-alpha-${siteA}` },
    ]);
    await db.insert(siteLocation).values([
      { id: locA, siteId: siteA, name: "T9 Users Loc A" },
    ]);
    await db.insert(user).values([hoActorRow, superActorRow]);
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, superActor));
    await db.delete(user).where(eq(user.id, hoActor));
    // Like-based sweep: rows minted by actions that failed mid-test (their
    // ids never got tracked) must not block the fixture teardown.
    await db.delete(user).where(like(user.email, "t9-%@shiftly.test"));
    await db.delete(siteLocation).where(eq(siteLocation.id, locA));
    await db.delete(site).where(eq(site.id, siteA));
  });

  test("the user table has no work_area_id column", async () => {
    const result = await db.execute(
      sql`select column_name from information_schema.columns
          where table_name = 'user' and column_name = 'work_area_id'`,
    );
    expect(result.rows).toEqual([]);
  });

  test("createUser drops a stray workAreaId payload instead of erroring", async () => {
    actor = superActorRow;
    const { createUser } = await import("./actions");
    const key = randomUUID();
    const payload = {
      name: "T9 Admin No WA",
      email: `t9-admin-${key}@shiftly.test`,
      password: "password-1234567",
      role: "admin",
      siteLocationId: locA,
      // The removed binding key must be inert: stripped before validation,
      // never an error, never persisted.
      workAreaId: randomUUID(),
    } as Parameters<typeof createUser>[0];
    const result = await createUser(payload);
    expect(result.ok).toBe(true);

    const [created] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, `t9-admin-${key}@shiftly.test`));
    expect(created).toBeDefined();
    trackedIds.push(created!.id);
  });

  test("updateUser drops a stray workAreaId payload instead of erroring", async () => {
    actor = superActorRow;
    const id = await mintUser({ role: "admin", siteLocationId: locA });
    const { updateUser } = await import("./actions");
    const payload = {
      name: "T9 Admin Edited",
      role: "admin",
      siteLocationId: locA,
      workAreaId: randomUUID(),
    } as Parameters<typeof updateUser>[1];
    const result = await updateUser(id, payload);
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, id));
    expect(row?.name).toBe("T9 Admin Edited");
  });
});
