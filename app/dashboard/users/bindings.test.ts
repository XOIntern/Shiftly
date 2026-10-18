import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { eq, like } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  department,
  site,
  siteLocation,
  user,
  workArea,
} from "@/drizzle/schema";
import type { SessionUser } from "@/lib/session";
import type { Role } from "@/lib/scope";

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
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));
mock.module("@/lib/credential-store", () => ({
  deleteUserSessions: async () => {},
  setCredentialPassword: async () => 0,
}));

async function loadBindings(id: string) {
  const [row] = await db
    .select({
      departmentId: user.departmentId,
      workAreaId: user.workAreaId,
      siteId: user.siteId,
      siteLocationId: user.siteLocationId,
    })
    .from(user)
    .where(eq(user.id, id));
  return row;
}

// Shared fixture: siteA (the ho actor's site) with a location, a department
// and a work area under that pair; siteB foreign with only a department.
// The rows live for the whole file — only the minted user targets are
// per-test and cleaned up individually.
const siteA = randomUUID();
const siteB = randomUUID();
const locA = randomUUID();
const deptA = randomUUID();
const deptB = randomUUID();
const waA = randomUUID();
const waB = randomUUID();
const locB = randomUUID();
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

describe("users bindings (department/work-area, issue #66)", () => {
  beforeAll(async () => {
    await db.insert(site).values([
      { id: siteA, name: `t9-users-site-alpha-${siteA}` },
      { id: siteB, name: `t9-users-site-beta-${siteB}` },
    ]);
    await db.insert(siteLocation).values([
      { id: locA, siteId: siteA, name: "T9 Users Loc A" },
      { id: locB, siteId: siteA, name: "T9 Users Loc B" },
    ]);
    await db.insert(department).values([
      { id: deptA, siteId: siteA, name: "T9 Dept A" },
      { id: deptB, siteId: siteB, name: "T9 Dept B" },
    ]);
    await db.insert(workArea).values([
      {
        id: waA,
        departmentId: deptA,
        siteLocationId: locA,
        siteId: siteA,
        name: "T9 WA A",
      },
      {
        id: waB,
        departmentId: deptA,
        siteLocationId: locB,
        siteId: siteA,
        name: "T9 WA B",
      },
    ]);
    await db.insert(user).values([hoActorRow, superActorRow]);
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, superActor));
    await db.delete(user).where(eq(user.id, hoActor));
    // Like-based sweep: rows minted by actions that failed mid-test (their
    // ids never got tracked) must not block the fixture teardown.
    await db.delete(user).where(like(user.email, "t9-%@shiftly.test"));
    await db.delete(workArea).where(like(workArea.name, "T9 WA %"));
    await db.delete(department).where(eq(department.id, deptA));
    await db.delete(department).where(eq(department.id, deptB));
    await db.delete(department).where(like(department.name, "T9 Dept Dead"));
    await db.delete(siteLocation).where(eq(siteLocation.id, locA));
    await db.delete(siteLocation).where(eq(siteLocation.id, locB));
    await db.delete(site).where(eq(site.id, siteA));
    await db.delete(site).where(eq(site.id, siteB));
  });

  test("superadmin actor persists departmentId/workAreaId on an admin create", async () => {
    actor = superActorRow;
    const { createUser } = await import("./actions");
    const key = randomUUID();
    const result = await createUser({
      name: "T9 Admin Super-made",
      email: `t9-admin-${key}@shiftly.test`,
      password: "password123",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptA,
      workAreaId: waA,
    });
    expect(result.ok).toBe(true);
    const [created] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, `t9-admin-${key}@shiftly.test`));
    expect(created).toBeDefined();
    trackedIds.push(created!.id);
    const row = await loadBindings(created!.id);
    expect(row?.departmentId).toBe(deptA);
    expect(row?.workAreaId).toBe(waA);
    expect(row?.siteId).toBe(null);
  });

  test("superadmin actor's department/workArea ids are stripped for a superadmin target", async () => {
    actor = superActorRow;
    const { createUser } = await import("./actions");
    const key = randomUUID();
    const email = `t9-super-${key}@shiftly.test`;
    const result = await createUser({
      name: "T9 Super Tampered",
      email,
      password: "password123",
      role: "superadmin",
      departmentId: deptA,
      workAreaId: waA,
    });
    expect(result.ok).toBe(true);
    const [created] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    expect(created).toBeDefined();
    trackedIds.push(created!.id);
    const row = await loadBindings(created!.id);
    expect(row?.departmentId).toBe(null);
    expect(row?.workAreaId).toBe(null);
    expect(row?.siteId).toBe(null);
    expect(row?.siteLocationId).toBe(null);
  });

  test("superadmin actor persists departmentId on an ho target (update), never workAreaId", async () => {
    actor = superActorRow;
    const id = await mintUser({ role: "ho", siteId: siteA });
    const { updateUser } = await import("./actions");
    const result = await updateUser(id, {
      name: "T9 HO Edited",
      role: "ho",
      siteId: siteA,
      departmentId: deptA,
      workAreaId: waA,
    });
    expect(result.ok).toBe(true);
    const row = await loadBindings(id);
    expect(row?.siteId).toBe(siteA);
    expect(row?.departmentId).toBe(deptA);
    expect(row?.workAreaId).toBe(null);
  });

  test("superadmin actor persists both new bindings on an admin edit", async () => {
    actor = superActorRow;
    const id = await mintUser({ role: "admin", siteLocationId: locA });
    const { updateUser } = await import("./actions");
    const result = await updateUser(id, {
      name: "T9 Admin Edited",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptA,
      workAreaId: waA,
    });
    expect(result.ok).toBe(true);
    const row = await loadBindings(id);
    expect(row?.departmentId).toBe(deptA);
    expect(row?.workAreaId).toBe(waA);
  });

  test("ho actor sets departmentId within their site → persists for the target", async () => {
    actor = hoActorRow;
    const { createUser } = await import("./actions");
    const key = randomUUID();
    const email = `t9-ho-admin-${key}@shiftly.test`;
    const result = await createUser({
      name: "T9 Admin HO-made",
      email,
      password: "password123",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptA,
    });
    expect(result.ok).toBe(true);
    const [created] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    expect(created).toBeDefined();
    trackedIds.push(created!.id);
    const row = await loadBindings(created!.id);
    expect(row?.departmentId).toBe(deptA);
    expect(row?.workAreaId).toBe(null);
  });

  test("ho actor sends a FOREIGN site's departmentId → per-field error, nothing persists", async () => {
    actor = hoActorRow;
    const { createUser } = await import("./actions");
    const email = `t9-ho-foreign-${randomUUID()}@shiftly.test`;
    const result = await createUser({
      name: "T9 Admin Foreign Dept",
      email,
      password: "password123",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptB,
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({
      departmentId: "Department must belong to your site",
    });
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    expect(row).toBeUndefined();
  });

  test("ho actor sends a soft-deleted own-site departmentId → per-field error", async () => {
    const deadDept = randomUUID();
    await db.insert(department).values({
      id: deadDept,
      siteId: siteA,
      name: "T9 Dept Dead",
      deletedAt: new Date(),
    });
    try {
      actor = hoActorRow;
      const { createUser } = await import("./actions");
      const result = await createUser({
        name: "T9 Admin Dead Dept",
        email: `t9-ho-dead-${randomUUID()}@shiftly.test`,
        password: "password123",
        role: "admin",
        siteLocationId: locA,
        departmentId: deadDept,
      });
      expect(result.ok).toBe(false);
      expect(result.fieldErrors).toEqual({
        departmentId: "Department must belong to your site",
      });
    } finally {
      await db.delete(department).where(eq(department.id, deadDept));
    }
  });

  test("ho actor sending workAreaId → never set, nothing persists", async () => {
    actor = hoActorRow;
    const { createUser } = await import("./actions");
    const key = randomUUID();
    const email = `t9-ho-wa-${key}@shiftly.test`;
    await createUser({
      name: "T9 Admin Tampered WA",
      email,
      password: "password123",
      role: "admin",
      siteLocationId: locA,
      workAreaId: waA,
    });
    const [row] = await db
      .select({ id: user.id, workAreaId: user.workAreaId })
      .from(user)
      .where(eq(user.email, email));
    expect(row).toBeDefined();
    trackedIds.push(row!.id);
    expect(row!.workAreaId).toBe(null);
  });

  test("23503 on the user.department FK routes to the department message", async () => {
    actor = superActorRow;
    const { createUser } = await import("./actions");
    const email = `t9-fk-dept-${randomUUID()}@shiftly.test`;
    const result = await createUser({
      name: "T9 FK Dept",
      email,
      password: "password123",
      role: "admin",
      siteLocationId: locA,
      departmentId: randomUUID(),
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({
      departmentId: "Selected department no longer exists",
    });
  });

  test("superadmin pairs a work area with a foreign location → per-field error", async () => {
    actor = superActorRow;
    const { createUser } = await import("./actions");
    const email = `t9-pair-${randomUUID()}@shiftly.test`;
    const result = await createUser({
      name: "T9 Pair Mismatch",
      email,
      password: "password123",
      role: "admin",
      siteLocationId: locA,
      workAreaId: waB,
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({
      workAreaId: "Work area must belong to the selected location",
    });
    const [row] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    expect(row).toBeUndefined();
  });

  test("23503 on the user.work_area FK routes to the work-area message", async () => {
    // The pairing net passes a nonexistent id through to the insert on
    // purpose, so the user.work_area FK's own 23503 answers here.
    actor = superActorRow;
    const { createUser } = await import("./actions");
    const email = `t9-fk-wa-${randomUUID()}@shiftly.test`;
    const result = await createUser({
      name: "T9 FK WA",
      email,
      password: "password123",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptA,
      workAreaId: randomUUID(),
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({
      workAreaId: "Selected work area no longer exists",
    });
  });

  test("superadmin create binds a SOFT-DELETED departmentId → field error, nothing persists", async () => {
    const deadDept2 = randomUUID();
    // Soft-deleted department inside a real location scope: the FK sees the
    // physical row, so only the load path can catch it.
    await db.insert(department).values({
      id: deadDept2,
      siteId: siteA,
      name: "T9 Dept Dead Bind",
      deletedAt: new Date(),
    });
    try {
      actor = superActorRow;
      const { createUser } = await import("./actions");
      const email = `t9-super-dead-dept-${randomUUID()}@shiftly.test`;
      const result = await createUser({
        name: "T9 Dead Dept Bind",
        email,
        password: "password123",
        role: "admin",
        siteLocationId: locA,
        departmentId: deadDept2,
      });
      expect(result.ok).toBe(false);
      expect(result.fieldErrors).toEqual({
        departmentId: "Selected department no longer exists",
      });
      const [row] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email));
      expect(row).toBeUndefined();
    } finally {
      await db.delete(department).where(eq(department.id, deadDept2));
    }
  });

  test("superadmin update binds a SOFT-DELETED departmentId on an ho target → field error, binding unchanged", async () => {
    const deadDept3 = randomUUID();
    await db.insert(department).values({
      id: deadDept3,
      siteId: siteA,
      name: "T9 Dept Dead Upd",
      deletedAt: new Date(),
    });
    try {
      actor = superActorRow;
      const id = await mintUser({ role: "ho", siteId: siteA });
      const { updateUser } = await import("./actions");
      const result = await updateUser(id, {
        name: "T9 HO Dead Dept",
        role: "ho",
        siteId: siteA,
        departmentId: deadDept3,
      });
      expect(result.ok).toBe(false);
      expect(result.fieldErrors).toEqual({
        departmentId: "Selected department no longer exists",
      });
      const row = await loadBindings(id);
      expect(row?.departmentId).toBe(null);
      expect(row?.siteId).toBe(siteA);
    } finally {
      await db.delete(department).where(eq(department.id, deadDept3));
    }
  });

  test("ho actor edit of an admin picks an own-site department → the pick persists (golden path)", async () => {
    actor = hoActorRow;
    const id = await mintUser({ role: "admin", siteLocationId: locA });
    // Seed a work area directly — the ho never sets one on edit.
    await db.update(user).set({ workAreaId: waA }).where(eq(user.id, id));
    const { updateUser } = await import("./actions");
    const result = await updateUser(id, {
      name: "T9 Golden Path",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptA,
      workAreaId: randomUUID(),
    });
    expect(result.ok).toBe(true);
    const row = await loadBindings(id);
    expect(row?.departmentId).toBe(deptA);
    // The pick persists; the work area stays pinned to the target's own.
    expect(row?.workAreaId).toBe(waA);
  });

  test("ho actor update picks a FOREIGN department → per-field error, nothing changes", async () => {
    actor = hoActorRow;
    const id = await mintUser({ role: "admin", siteLocationId: locA });
    const { updateUser } = await import("./actions");
    const result = await updateUser(id, {
      name: "T9 Foreign Dept Edit",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptB,
    });
    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({
      departmentId: "Department must belong to your site",
    });
    const row = await loadBindings(id);
    expect(row?.departmentId).toBe(null);
  });

  test("superadmin create binds a SOFT-DELETED work area at the right location → field error, nothing persists", async () => {
    const deadWa = randomUUID();
    await db.insert(workArea).values({
      id: deadWa,
      departmentId: deptA,
      siteLocationId: locA,
      siteId: siteA,
      name: "T9 WA Dead Create",
      deletedAt: new Date(),
    });
    try {
      actor = superActorRow;
      const { createUser } = await import("./actions");
      const email = `t9-dead-wa-create-${randomUUID()}@shiftly.test`;
      const result = await createUser({
        name: "T9 Dead WA Create",
        email,
        password: "password123",
        role: "admin",
        siteLocationId: locA,
        workAreaId: deadWa,
      });
      expect(result.ok).toBe(false);
      expect(result.fieldErrors).toEqual({
        workAreaId: "Selected work area no longer exists",
      });
      const [row] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email));
      expect(row).toBeUndefined();
    } finally {
      await db.delete(workArea).where(eq(workArea.id, deadWa));
    }
  });

  test("superadmin UPDATE binds a SOFT-DELETED work area at the right location → field error, binding unchanged", async () => {
    const deadWa = randomUUID();
    await db.insert(workArea).values({
      id: deadWa,
      departmentId: deptA,
      siteLocationId: locA,
      siteId: siteA,
      name: "T9 WA Dead Update",
      deletedAt: new Date(),
    });
    try {
      actor = superActorRow;
      const id = await mintUser({ role: "admin", siteLocationId: locA });
      const { updateUser } = await import("./actions");
      const result = await updateUser(id, {
        name: "T9 Dead WA Update",
        role: "admin",
        siteLocationId: locA,
        departmentId: deptA,
        workAreaId: deadWa,
      });
      expect(result.ok).toBe(false);
      expect(result.fieldErrors).toEqual({
        workAreaId: "Selected work area no longer exists",
      });
      const row = await loadBindings(id);
      expect(row?.workAreaId).toBe(null);
      expect(row?.siteLocationId).toBe(locA);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, deadWa));
    }
  });

  test("ho edit of a drifted admin (pre-existing mismatched work area) succeeds — net not applied to ho", async () => {
    actor = hoActorRow;
    const id = await mintUser({ role: "admin", siteLocationId: locA });
    // Drift seeded directly: the target already carries a work area that
    // does not pair with its location. The ho edit pins these values, so
    // the pairing net must not re-check them for an ho actor.
    await db
      .update(user)
      .set({ workAreaId: waB })
      .where(eq(user.id, id));
    const { updateUser } = await import("./actions");
    const result = await updateUser(id, {
      name: "T9 Drifted Admin Edited",
      role: "admin",
      siteLocationId: locA,
      departmentId: deptA,
      workAreaId: randomUUID(),
    });
    expect(result.ok).toBe(true);
    const row = await loadBindings(id);
    expect(row?.workAreaId).toBe(waB);
    expect(row?.siteLocationId).toBe(locA);
  });
});

