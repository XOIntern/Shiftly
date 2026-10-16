import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { site, siteLocation, user } from "@/drizzle/schema";
import type { SessionUser } from "@/lib/session";

// The users page reads its actor through requireHO — swapped for a stub so
// the real server component can render against the test database without
// a Next request context.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  requireHO: async () => actor,
}));

type Entry = {
  user: { id: string; name: string; binding: string | null; role: string };
  form: { id: string };
  canManage: boolean;
};

// The page returns an RSC object tree; the user rows travel to the client
// table as the entries prop on <UsersTable>.
function collectEntries(node: unknown, out: Entry[]): Entry[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectEntries(child, out);
    return out;
  }
  const props = (node as { props?: { children?: unknown; entries?: unknown } })
    .props;
  if (props) {
    if (Array.isArray(props.entries)) {
      out.push(...(props.entries as Entry[]));
    }
    collectEntries(props.children, out);
  }
  return out;
}

function collectPageProps(node: unknown, out: { pageCount?: number; total?: number }[]) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectPageProps(child, out);
    return out;
  }
  const props = (node as {
    props?: { children?: unknown; entries?: unknown; pageCount?: unknown; total?: unknown };
  }).props;
  if (props) {
    if ("entries" in props) {
      out.push({
        pageCount: props.pageCount as number | undefined,
        total: props.total as number | undefined,
      });
    }
    collectPageProps(props.children, out);
  }
  return out;
}

type Options = { actorRole: string; sites: unknown; locations: unknown };

// The form options travel on the create dialog (first in the tree) and on
// each row's edit dialog — all must obey the actor's scope.
function collectOptions(node: unknown, out: Options[]): Options[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectOptions(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props) {
    const p = props.props as Record<string, unknown>;
    if ("actorRole" in p && "sites" in p && "locations" in p) {
      out.push(p as unknown as Options);
    }
    collectOptions(p.children, out);
  }
  return out;
}

async function renderUsers(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<{
  entries: Entry[];
  options: Options[];
  page: { pageCount?: number; total?: number };
}> {
  const { default: UsersPage } = await import("./page");
  const tree = await UsersPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  return {
    entries: collectEntries(tree, []),
    options: collectOptions(tree, []),
    page: collectPageProps(tree, [])[0] ?? {},
  };
}

// t3- prefixed real-DB fixtures for issue #18: uuid ids so two suites can
// run concurrently without colliding.
describe("users page scoping (issue #18)", () => {
  test("ho actor sees only its own site's users and gets no cross-scope options", async () => {
    const siteA = randomUUID();
    const siteB = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const locC = randomUUID();
    const hoActor = randomUUID();
    const hoForeign = randomUUID();
    const saRow = randomUUID();
    const adminA = randomUUID();
    const adminB = randomUUID();
    const adminMalformed = randomUUID();

    const mkEmail = (id: string) => `t3-users-${id}@shiftly.test`;
    try {
      await db.insert(site).values([
        { id: siteA, name: `t3-users-site-alpha-${siteA}` },
        { id: siteB, name: `t3-users-site-beta-${siteB}` },
      ]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T3 Users Loc A" },
        { id: locB, siteId: siteB, name: "T3 Users Loc B" },
        { id: locC, siteId: siteA, name: "T3 Users Loc C" },
      ]);
      await db.insert(user).values([
        {
          id: hoActor,
          name: "T3 Actor HO",
          email: mkEmail(hoActor),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: hoForeign,
          name: "T3 Foreign HO",
          email: mkEmail(hoForeign),
          emailVerified: true,
          role: "ho",
          siteId: siteB,
        },
        {
          id: saRow,
          name: "T3 Superadmin",
          email: mkEmail(saRow),
          emailVerified: true,
          role: "superadmin",
        },
        {
          id: adminA,
          name: "T3 Admin A",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: adminB,
          name: "T3 Admin B",
          email: mkEmail(adminB),
          emailVerified: true,
          role: "admin",
          siteLocationId: locB,
        },
        {
          id: adminMalformed,
          name: "T3 Malformed Admin",
          email: mkEmail(adminMalformed),
          emailVerified: true,
          role: "admin",
        },
      ]);

      actor = {
        id: hoActor,
        name: "T3 Actor HO",
        email: mkEmail(hoActor),
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };
      const { entries, options } = await renderUsers();

      // Scoped listing: only the ho's own row plus admins of its site's
      // locations. Foreign rows and superadmin rows never leak.
      expect(entries.map((e) => e.user.id).sort()).toEqual(
        [hoActor, adminA].sort(),
      );
      // Own ho row is visible but not manageable; own-site admin manageable.
      const own = entries.find((e) => e.user.id === hoActor)!;
      const admin = entries.find((e) => e.user.id === adminA)!;
      expect(own.canManage).toBe(false);
      expect(admin.canManage).toBe(true);

      // Form options follow the actor's site: locations filtered to the
      // ho's own site, sites never offered (ho roles bind nothing).
      for (const option of options) {
        expect(option.actorRole).toBe("ho");
        expect(option.sites).toEqual([]);
        const locationIds = (option.locations as Array<{ id: string }>).map(
          (l) => l.id,
        );
        expect(locationIds.sort()).toEqual([locA, locC].sort());
      }
    } finally {
      await db.delete(user).where(eq(user.id, hoActor));
      await db.delete(user).where(eq(user.id, hoForeign));
      await db.delete(user).where(eq(user.id, saRow));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(user).where(eq(user.id, adminB));
      await db.delete(user).where(eq(user.id, adminMalformed));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locC));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
    }
  });

  test("superadmin actor sees all rows and full option lists", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const saActor = randomUUID();
    const hoRow = randomUUID();
    const adminA = randomUUID();

    const mkEmail = (id: string) => `t3-users-${id}@shiftly.test`;
    try {
      await db.insert(site).values([{ id: siteA, name: `t3-users-site-gamma-${siteA}` }]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T3 Users Loc G" },
      ]);
      await db.insert(user).values([
        {
          id: saActor,
          name: "T3 Superadmin Actor",
          email: mkEmail(saActor),
          emailVerified: true,
          role: "superadmin",
        },
        {
          id: hoRow,
          name: "T3 Site HO",
          email: mkEmail(hoRow),
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
        {
          id: adminA,
          name: "T3 Admin G",
          email: mkEmail(adminA),
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
      ]);

      actor = {
        id: saActor,
        name: "T3 Superadmin Actor",
        email: mkEmail(saActor),
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };
      const { entries, options } = await renderUsers();

      // No scope filter: every fixture user row shows, and the superadmin
      // manages everything it can see. (The shared dev DB may hold other
      // suites' rows — the unfiltered list must contain all fixtures.)
      const visibleIds = new Set(entries.map((e) => e.user.id));
      for (const id of [saActor, hoRow, adminA]) {
        expect(visibleIds.has(id)).toBe(true);
      }
      for (const hello of [
        entries.find((e) => e.user.id === saActor),
        entries.find((e) => e.user.id === hoRow),
        entries.find((e) => e.user.id === adminA),
      ]) {
        expect(hello!.canManage).toBe(true);
      }

      // All sites and all locations are offered, nothing filtered away.
      for (const option of options) {
        expect(option.actorRole).toBe("superadmin");
        expect(
          (option.sites as Array<{ id: string }>).map((s) => s.id),
        ).toContain(siteA);
        expect(
          (option.locations as Array<{ id: string }>).map((l) => l.id),
        ).toContain(locA);
      }
    } finally {
      await db.delete(user).where(eq(user.id, saActor));
      await db.delete(user).where(eq(user.id, hoRow));
      await db.delete(user).where(eq(user.id, adminA));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("q matches name OR email, scoped; pageCount/total travel (issue #22)", async () => {
    const siteA = randomUUID();
    const locA = randomUUID();
    const nameMatch = randomUUID();
    const emailMatch = randomUUID();
    const missed = randomUUID();
    try {
      await db.insert(site).values([{ id: siteA, name: `t4-users-site-${randomUUID().slice(0, 6)}` }]);
      await db.insert(siteLocation).values([
        { id: locA, siteId: siteA, name: "T4 Users Loc A" },
      ]);
      const token = randomUUID().slice(0, 8);
      await db.insert(user).values([
        {
          id: nameMatch,
          name: `t4-token-${token}`,
          email: `t4-users-${nameMatch}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: emailMatch,
          name: "unrelated joe",
          email: `t4-token-${token}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
        {
          id: missed,
          name: "unrelated sam",
          email: `t4-users-${missed}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: locA,
        },
      ]);

      actor = {
        id: randomUUID(),
        name: "T4 Ho Actor",
        email: `t4-users-${randomUUID()}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };
      const { entries, page } = await renderUsers({ q: token });

      expect(entries.map((e) => e.user.id).sort()).toEqual(
        [nameMatch, emailMatch].sort(),
      );
      expect(page.total).toBe(2);
      expect(page.pageCount).toBe(1);
    } finally {
      await db.delete(user).where(eq(user.id, nameMatch));
      await db.delete(user).where(eq(user.id, emailMatch));
      await db.delete(user).where(eq(user.id, missed));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("status filter keeps only active or inactive rows; junk shows all", async () => {
    const token = `t4-users-status-${randomUUID().slice(0, 8)}`;
    const activeId = randomUUID();
    const inactiveId = randomUUID();
    try {
      await db.insert(user).values([
        {
          id: activeId,
          name: "t4-status-on",
          email: `${token}-on@shiftly.test`,
          emailVerified: true,
          role: "admin",
          isActive: true,
        },
        {
          id: inactiveId,
          name: "t4-status-off",
          email: `${token}-off@shiftly.test`,
          emailVerified: true,
          role: "admin",
          isActive: false,
        },
      ]);

      actor = {
        id: randomUUID(),
        name: "T4 Status Sa",
        email: `t4-users-${randomUUID()}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };

      const all = await renderUsers({ q: token });
      expect(all.entries.map((e) => e.user.id).sort()).toEqual(
        [activeId, inactiveId].sort(),
      );

      const active = await renderUsers({ q: token, status: "active" });
      expect(active.entries.map((e) => e.user.id)).toEqual([activeId]);
      expect(active.page.total).toBe(1);

      const inactive = await renderUsers({ q: token, status: "inactive" });
      expect(inactive.entries.map((e) => e.user.id)).toEqual([inactiveId]);
      expect(inactive.page.total).toBe(1);

      // Whitelist: anything else parses to no filter.
      const junk = await renderUsers({ q: token, status: "junk" as never });
      expect(junk.entries).toHaveLength(2);
    } finally {
      await db.delete(user).where(eq(user.id, activeId));
      await db.delete(user).where(eq(user.id, inactiveId));
    }
  });

  test("sort=binding orders by location name with NULL bindings last", async () => {
    const siteA = randomUUID();
    const locAlpha = randomUUID();
    const locBeta = randomUUID();
    const boundAlpha = randomUUID();
    const boundBeta = randomUUID();
    const unbound = randomUUID();
    try {
      await db.insert(site).values([{ id: siteA, name: `t4-users-site-${randomUUID().slice(0, 6)}` }]);
      await db.insert(siteLocation).values([
        {
          id: locAlpha,
          siteId: siteA,
          name: "T4 Users Loc Alpha",
        },
        { id: locBeta, siteId: siteA, name: "T4 Users Loc Beta" },
      ]);
      await db.insert(user).values([
        {
          id: boundAlpha,
          name: "t4-binding-a",
          email: `t4-users-${boundAlpha}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: locAlpha,
        },
        {
          id: boundBeta,
          name: "t4-binding-b",
          email: `t4-users-${boundBeta}@shiftly.test`,
          emailVerified: true,
          role: "admin",
          siteLocationId: locBeta,
        },
        {
          id: unbound,
          name: "t4-binding-z",
          email: `t4-users-${unbound}@shiftly.test`,
          emailVerified: true,
          role: "ho",
          siteId: siteA,
        },
      ]);

      actor = {
        id: randomUUID(),
        name: "T4 Ho Actor",
        email: `t4-users-${randomUUID()}@shiftly.test`,
        role: "ho",
        siteId: siteA,
        siteLocationId: null,
        isActive: true,
      };
      const { entries } = await renderUsers({
        q: "t4-binding-",
        sort: "binding",
      });

      // Postgres ASC puts NULLs last: both location-bound rows ordered by
      // their location name, then the site-bound ho row with no location.
      expect(entries.map((e) => e.user.id)).toEqual([
        boundAlpha,
        boundBeta,
        unbound,
      ]);
    } finally {
      await db.delete(user).where(eq(user.id, boundAlpha));
      await db.delete(user).where(eq(user.id, boundBeta));
      await db.delete(user).where(eq(user.id, unbound));
      await db.delete(siteLocation).where(eq(siteLocation.id, locAlpha));
      await db.delete(siteLocation).where(eq(siteLocation.id, locBeta));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("multi-sort: the second key orders within ties of the first", async () => {
    const token = `t4-users-multi-${randomUUID().slice(0, 8)}`;
    const userA = randomUUID();
    const userB = randomUUID();
    try {
      // Both active admins: isActive alone ties them, so only the explicit
      // second key (name desc) can produce this order.
      await db.insert(user).values([
        {
          id: userA,
          name: `${token}-a`,
          email: `t4-users-${userA}@shiftly.test`,
          emailVerified: true,
          role: "admin",
        },
        {
          id: userB,
          name: `${token}-b`,
          email: `t4-users-${userB}@shiftly.test`,
          emailVerified: true,
          role: "admin",
        },
      ]);

      actor = {
        id: randomUUID(),
        name: "T4 Multi Sa",
        email: `t4-users-${randomUUID()}@shiftly.test`,
        role: "superadmin",
        siteId: null,
        siteLocationId: null,
        isActive: true,
      };
      const { entries } = await renderUsers({
        q: token,
        sort: "isActive:desc,name:desc",
      });

      expect(entries.map((e) => e.user.id)).toEqual([userB, userA]);
    } finally {
      await db.delete(user).where(eq(user.id, userA));
      await db.delete(user).where(eq(user.id, userB));
    }
  });

  test("a bogus sort falls back to role/name order; page=999 clamps", async () => {
    const siteA = randomUUID();
    const token = `t4-users-clamp-${randomUUID().slice(0, 8)}`;
    const siteId = siteA;
    const ids = Array.from({ length: 15 }, () => randomUUID());
    try {
      await db.insert(site).values([
        { id: siteId, name: `t4-users-site-${randomUUID().slice(0, 6)}` },
      ]);
      await db.insert(user).values(
        ids.map((id, i) => ({
          id,
          name: `${token}-${String(i + 1).padStart(2, "0")}`,
          email: `t4-users-${id}@shiftly.test`,
          emailVerified: true,
          role: "ho" as const,
          siteId,
        })),
      );

      actor = {
        id: randomUUID(),
        name: "T4 Ho Actor",
        email: `t4-users-${randomUUID()}@shiftly.test`,
        role: "ho",
        siteId,
        siteLocationId: null,
        isActive: true,
      };

      const bogus = await renderUsers({
        q: token,
        sort: "bogus" as never,
        dir: "desc" as never,
      });
      // Default order (role asc, name asc) — for same-role fixtures that is
      // plain name order. Page 1 of the fixed page size 10 shows the first
      // ten in that order.
      expect(bogus.entries.map((e) => e.user.id)).toEqual(ids.slice(0, 10));

      const clamped = await renderUsers({ q: token, page: "999" });
      expect(clamped.page.pageCount).toBe(2);
      expect(clamped.page.total).toBe(15);
      expect(clamped.entries.length).toBe(5);
      expect(
        clamped.entries.map((e) => e.user.name.slice(-2)),
      ).toEqual(["11", "12", "13", "14", "15"]);
    } finally {
      await db.delete(user).where(inArray(user.id, ids));
      await db.delete(site).where(eq(site.id, siteA));
    }
  });

  test("pageSize=20 widens one page; a non-whitelist pageSize falls to 10 (rows per page)", async () => {
    const siteId = randomUUID();
    const token = `t4-users-psize-${randomUUID().slice(0, 8)}`;
    const ids = Array.from({ length: 15 }, () => randomUUID());
    try {
      await db.insert(site).values([
        { id: siteId, name: `t4-users-site-${randomUUID().slice(0, 6)}` },
      ]);
      await db.insert(user).values(
        ids.map((id, i) => ({
          id,
          name: `${token}-${String(i + 1).padStart(2, "0")}`,
          email: `t4-users-${id}@shiftly.test`,
          emailVerified: true,
          role: "ho" as const,
          siteId,
        })),
      );

      actor = {
        id: randomUUID(),
        name: "T4 Ho Actor",
        email: `t4-users-${randomUUID()}@shiftly.test`,
        role: "ho",
        siteId,
        siteLocationId: null,
        isActive: true,
      };

      const widened = await renderUsers({ q: token, pageSize: "20" });
      expect(widened.entries.length).toBe(15);
      expect(widened.page.total).toBe(15);
      expect(widened.page.pageCount).toBe(1);

      const capped = await renderUsers({ q: token, pageSize: "7" as never });
      expect(capped.entries.length).toBe(10);
      expect(capped.page.pageCount).toBe(2);
      expect(capped.page.total).toBe(15);
    } finally {
      await db.delete(user).where(inArray(user.id, ids));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
