import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

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
  user: { id: string; binding: string | null; role: string };
  form: { id: string };
  canManage: boolean;
};

// The page returns an RSC object tree; the user rows live on the
// TableRowCells elements as props.entry.
function collectEntries(node: unknown, out: Entry[]): Entry[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectEntries(child, out);
    return out;
  }
  const props = (node as { props?: { children?: unknown; entry?: unknown } })
    .props;
  if (props) {
    if (props.entry) out.push(props.entry as Entry);
    collectEntries(props.children, out);
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

async function renderUsers(): Promise<{
  entries: Entry[];
  options: Options[];
}> {
  const { default: UsersPage } = await import("./page");
  const tree = await UsersPage();
  return {
    entries: collectEntries(tree, []),
    options: collectOptions(tree, []),
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
        { id: locA, siteId: siteA, name: "T3 Users Loc A", address: "x" },
        { id: locB, siteId: siteB, name: "T3 Users Loc B", address: "x" },
        { id: locC, siteId: siteA, name: "T3 Users Loc C", address: "x" },
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
        { id: locA, siteId: siteA, name: "T3 Users Loc G", address: "x" },
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
});
