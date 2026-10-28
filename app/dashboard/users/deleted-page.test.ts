import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { user } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import { seedLocation, seedSite } from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

// The users page reads its actor through requireHO — swapped for a stub so
// the real server component can render against the test database without a
// Next request context. The whole module is swapped process-wide, so every
// export other suites may resolve exists here, not only the one this page
// reads.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

type DeletedRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  binding: string | null;
  deletedAt: string;
};

type UsersNode = {
  users: DeletedRow[];
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the deleted rows travel to the client
// table as the users/pageCount/total props on <DeletedUsersTable>, the live
// ones as the entries prop on <UsersTable>.
function collectUsers(node: unknown, out: UsersNode[]): UsersNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectUsers(child, out);
    return out;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props && "users" in props) {
    out.push(props as unknown as UsersNode);
  }
  if (props) collectUsers(props.children, out);
  return out;
}

function collectEntryIds(node: unknown, out: string[]): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectEntryIds(child, out);
    return out;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props) {
    if (Array.isArray(props.entries)) {
      for (const entry of props.entries as { user: { id: string } }[]) {
        out.push(entry.user.id);
      }
    }
    collectEntryIds(props.children, out);
  }
  return out;
}

async function renderTree(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const { default: UsersPage } = await import("./page");
  return UsersPage({ searchParams: Promise.resolve(searchParams) } as never);
}

async function renderDeleted(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<UsersNode> {
  const found = collectUsers(await renderTree({ show: "deleted", ...searchParams }), []);
  expect(found.length).toBe(1);
  return found[0];
}

function actorOf(
  role: SessionUser["role"],
  siteId: string | null = null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "Users Deleted Actor",
    email: `t193-page-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId: null,
    isActive: true,
  };
}

// Users seeded straight into the table so each row can carry its own
// deletedAt and a searchable name token. `token` pins every query to this
// call's rows: the shared dev DB holds other suites' deleted users too.
async function seedUsers(
  token: string,
  rows: Array<{
    suffix: string;
    role: "superadmin" | "ho" | "admin";
    siteId?: string;
    siteLocationId?: string;
    deletedAt: Date | null;
    isActive?: boolean;
  }>,
) {
  const ids = rows.map(() => randomUUID());
  cleanup.defer(async () => {
    for (const id of ids) await db.delete(user).where(eq(user.id, id));
  });
  await db.insert(user).values(
    rows.map((row, i) => ({
      id: ids[i],
      name: `${token}-${row.suffix}`,
      email: `${token}-${row.suffix}@shiftly.test`.toLowerCase(),
      emailVerified: true,
      role: row.role,
      siteId: row.siteId ?? null,
      siteLocationId: row.siteLocationId ?? null,
      isActive: row.isActive ?? true,
      deletedAt: row.deletedAt,
    })),
  );
  return ids;
}

function newToken() {
  return `t193-${randomUUID().slice(0, 8)}`;
}

describe("users page deleted view", () => {
  test("a superadmin lists only deleted users, newest deletion first, with role, binding and date", async () => {
    const token = newToken();
    const site = await seedSite(cleanup, { name: `${token}-site` });
    const loc = await seedLocation(cleanup, site.id, { name: `${token}-loc` });
    const ids = await seedUsers(token, [
      { suffix: "live", role: "superadmin", deletedAt: null },
      {
        suffix: "older",
        role: "ho",
        siteId: site.id,
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        suffix: "newer",
        role: "admin",
        siteId: site.id,
        siteLocationId: loc.id,
        deletedAt: new Date("2026-02-01T10:00:00Z"),
      },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ q: token });

    expect(props.users.map((u) => u.id)).toEqual([ids[2], ids[1]]);
    expect(props.users[0]).toMatchObject({
      role: "admin",
      binding: `${site.name} (${loc.name})`,
      deletedAt: "2026-02-01T10:00:00.000Z",
    });
    expect(props.users[1]).toMatchObject({ role: "ho", binding: site.name });
    expect(props.total).toBe(2);
  });

  test("q matches name, email or role text within the deleted view", async () => {
    const token = newToken();
    const ids = await seedUsers(token, [
      {
        suffix: "alpha",
        role: "superadmin",
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        suffix: "beta",
        role: "superadmin",
        deletedAt: new Date("2026-01-02T10:00:00Z"),
      },
    ]);
    actor = actorOf("superadmin");

    const byName = await renderDeleted({ q: `${token}-alpha` });
    expect(byName.users.map((u) => u.id)).toEqual([ids[0]]);

    const byEmail = await renderDeleted({ q: `${token}-beta@shiftly` });
    expect(byEmail.users.map((u) => u.id)).toEqual([ids[1]]);
  });

  test("the role and status filters apply to the deleted list", async () => {
    const token = newToken();
    const site = await seedSite(cleanup);
    const ids = await seedUsers(token, [
      {
        suffix: "sa",
        role: "superadmin",
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      },
      {
        suffix: "ho-on",
        role: "ho",
        siteId: site.id,
        deletedAt: new Date("2026-01-02T10:00:00Z"),
        isActive: true,
      },
      {
        suffix: "ho-off",
        role: "ho",
        siteId: site.id,
        deletedAt: new Date("2026-01-03T10:00:00Z"),
        isActive: false,
      },
    ]);
    actor = actorOf("superadmin");

    const hos = await renderDeleted({ q: token, role: "ho" });
    expect(hos.users.map((u) => u.id)).toEqual([ids[2], ids[1]]);

    const inactiveHos = await renderDeleted({
      q: token,
      role: "ho",
      status: "inactive",
    });
    expect(inactiveHos.users.map((u) => u.id)).toEqual([ids[2]]);
  });

  test("sort=name:asc orders by name; sort=deletedAt:asc by date", async () => {
    const token = newToken();
    const ids = await seedUsers(token, [
      {
        suffix: "b",
        role: "superadmin",
        deletedAt: new Date("2026-02-01T10:00:00Z"),
      },
      {
        suffix: "a",
        role: "superadmin",
        deletedAt: new Date("2026-03-01T10:00:00Z"),
      },
    ]);
    actor = actorOf("superadmin");

    const byName = await renderDeleted({ q: token, sort: "name:asc" });
    expect(byName.users.map((u) => u.id)).toEqual([ids[1], ids[0]]);

    const byDate = await renderDeleted({ q: token, sort: "deletedAt:asc" });
    expect(byDate.users.map((u) => u.id)).toEqual([ids[0], ids[1]]);
  });

  test("users deleted at the same instant list by ascending id, whatever the insert order", async () => {
    const token = newToken();
    const sameInstant = new Date("2026-01-01T10:00:00Z");
    const ids = await seedUsers(
      token,
      Array.from({ length: 4 }, (_, i) => ({
        suffix: `s${i}`,
        role: "superadmin" as const,
        deletedAt: sameInstant,
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ q: token });

    expect(props.users.map((u) => u.id)).toEqual([...ids].sort());
  });

  test("an HO lists only the deleted admins of their site's locations, deleted locations included", async () => {
    const token = newToken();
    const siteA = await seedSite(cleanup);
    const siteB = await seedSite(cleanup);
    const liveLoc = await seedLocation(cleanup, siteA.id);
    const deletedLoc = await seedLocation(cleanup, siteA.id, { deleted: true });
    const foreignLoc = await seedLocation(cleanup, siteB.id);
    const when = new Date("2026-01-01T10:00:00Z");
    const ids = await seedUsers(token, [
      {
        suffix: "admin-live-loc",
        role: "admin",
        siteId: siteA.id,
        siteLocationId: liveLoc.id,
        deletedAt: when,
      },
      {
        suffix: "admin-deleted-loc",
        role: "admin",
        siteId: siteA.id,
        siteLocationId: deletedLoc.id,
        deletedAt: when,
      },
      {
        suffix: "admin-foreign",
        role: "admin",
        siteId: siteB.id,
        siteLocationId: foreignLoc.id,
        deletedAt: when,
      },
      {
        suffix: "admin-still-live",
        role: "admin",
        siteId: siteA.id,
        siteLocationId: liveLoc.id,
        deletedAt: null,
      },
      { suffix: "ho-own", role: "ho", siteId: siteA.id, deletedAt: when },
      { suffix: "superadmin", role: "superadmin", deletedAt: when },
    ]);
    actor = actorOf("ho", siteA.id);

    const props = await renderDeleted({ q: token });

    expect(props.users.map((u) => u.id).sort()).toEqual(
      [ids[0], ids[1]].sort(),
    );
    expect(props.total).toBe(2);
  });

  test("an HO bound to no site sees nothing", async () => {
    const token = newToken();
    const site = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, site.id);
    await seedUsers(token, [
      {
        suffix: "admin",
        role: "admin",
        siteId: site.id,
        siteLocationId: loc.id,
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      },
    ]);
    actor = actorOf("ho", null);

    const props = await renderDeleted({ q: token });

    expect(props.users).toEqual([]);
    expect(props.total).toBe(0);
  });

  test("pagination math holds in the deleted view", async () => {
    const token = newToken();
    await seedUsers(
      token,
      Array.from({ length: 12 }, (_, i) => ({
        suffix: String(i).padStart(2, "0"),
        role: "superadmin" as const,
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ q: token, page: "999" });

    expect(props.total).toBe(12);
    expect(props.pageCount).toBe(2);
    expect(props.users).toHaveLength(2);
  });

  test("no show, an unknown show and a repeated show keep listing live users only", async () => {
    const token = newToken();
    const ids = await seedUsers(token, [
      { suffix: "live", role: "superadmin", deletedAt: null },
      {
        suffix: "gone",
        role: "superadmin",
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      },
    ]);
    actor = actorOf("superadmin");

    for (const show of [undefined, "bogus", "DELETED", ["deleted", "deleted"]]) {
      const tree = await renderTree({ q: token, show });
      expect(collectEntryIds(tree, [])).toEqual([ids[0]]);
      expect(collectUsers(tree, [])).toEqual([]);
    }
  });
});
