import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { shiftDefinition, site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The shifts page reads its actor through requireUser (all three roles see
// the page; scope differs per role) — swapped for a stub so the real server
// component can render against the test database. The mock swaps the WHOLE
// module across bun's single test process, so every export other suites may
// resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

type DeletedRow = {
  id: string;
  label: string;
  orderIndex: number;
  startTime: string;
  endTime: string;
  siteName: string;
  locationName: string;
  deletedAt: string;
};

type ShiftNode = {
  shifts: DeletedRow[];
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the shifts travel to the client table
// as the shifts/pageCount/total props on <ShiftsTable> or
// <DeletedShiftsTable>.
function collectShifts(node: unknown, out: ShiftNode[]): ShiftNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectShifts(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "shifts" in props.props) {
    out.push(props.props as unknown as ShiftNode);
    collectShifts(props.props.children, out);
  } else if (props.props) {
    collectShifts(props.props.children, out);
  }
  return out;
}

async function renderShifts(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<ShiftNode> {
  const { default: ShiftsPage } = await import("./page");
  const tree = await ShiftsPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectShifts(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

function renderDeleted(
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  return renderShifts({ show: "deleted", ...searchParams });
}

function actorOf(
  role: SessionUser["role"],
  siteId: string | null = null,
  siteLocationId: string | null = null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "Shift Deleted Actor",
    email: `t192-page-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// One site with two locations and shifts seeded straight into the table so
// each row can carry its own deletedAt. The site name doubles as the search
// token; `loc` picks which location a shift goes under. A location's order
// indexes are unique among live rows, so live rows get distinct ones.
async function seedSiteWith(
  rows: Array<{
    suffix: string;
    deletedAt: Date | null;
    orderIndex?: number;
    isActive?: boolean;
    loc?: "a" | "b";
  }>,
) {
  const siteId = randomUUID();
  const locA = randomUUID();
  const locB = randomUUID();
  const token = `t192-page-${randomUUID().slice(0, 8)}`;
  fixtureCleanup.defer(async () => {
    await db.delete(shiftDefinition).where(eq(shiftDefinition.siteId, siteId));
    await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
    await db.delete(site).where(eq(site.id, siteId));
  });
  await db.insert(site).values({ id: siteId, name: token });
  await db.insert(siteLocation).values([
    { id: locA, siteId, name: `${token}-loc-a` },
    { id: locB, siteId, name: `${token}-loc-b` },
  ]);
  const ids = rows.map(() => randomUUID());
  await db.insert(shiftDefinition).values(
    rows.map((row, i) => ({
      id: ids[i],
      siteId,
      siteLocationId: row.loc === "b" ? locB : locA,
      label: `${token}-${row.suffix}`,
      orderIndex: row.orderIndex ?? i + 1,
      startTime: "06:00",
      endTime: "14:00",
      isActive: row.isActive ?? true,
      deletedAt: row.deletedAt,
    })),
  );
  return { siteId, locA, locB, token, ids };
}

describe("shifts page deleted view", () => {
  test("lists only soft-deleted shifts, newest deletion first, with order, time, site, location and date", async () => {
    const { siteId, token, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "older", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "newer", deletedAt: new Date("2026-02-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.shifts.map((s) => s.id)).toEqual([ids[2], ids[1]]);
    expect(props.shifts[0]).toMatchObject({
      orderIndex: 3,
      startTime: "06:00",
      endTime: "14:00",
      siteName: token,
      locationName: `${token}-loc-a`,
      deletedAt: "2026-02-01T10:00:00.000Z",
    });
    expect(props.total).toBe(2);
  });

  test("q matches the label within the deleted view", async () => {
    const { token, ids } = await seedSiteWith([
      { suffix: "alpha", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "beta", deletedAt: new Date("2026-01-02T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ q: `${token}-alpha` });

    expect(props.shifts.map((s) => s.id)).toEqual([ids[0]]);
  });

  test("the status filter applies to the deleted list too", async () => {
    const { siteId, ids } = await seedSiteWith([
      {
        suffix: "on",
        deletedAt: new Date("2026-01-01T10:00:00Z"),
        isActive: true,
      },
      {
        suffix: "off",
        deletedAt: new Date("2026-01-02T10:00:00Z"),
        isActive: false,
      },
    ]);
    actor = actorOf("superadmin");

    const inactive = await renderDeleted({ siteId, status: "inactive" });

    expect(inactive.shifts.map((s) => s.id)).toEqual([ids[1]]);
  });

  test("the site filter applies to the deleted list for a superadmin", async () => {
    const a = await seedSiteWith([
      { suffix: "a", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    const b = await seedSiteWith([
      { suffix: "b", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId: a.siteId });

    expect(props.shifts.map((s) => s.id)).toEqual([a.ids[0]]);
    expect(props.shifts.map((s) => s.id)).not.toContain(b.ids[0]);
  });

  test("the order index sorts numerically, not as text", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "ten", deletedAt: new Date("2026-01-01T10:00:00Z"), orderIndex: 10 },
      { suffix: "two", deletedAt: new Date("2026-01-02T10:00:00Z"), orderIndex: 2 },
    ]);
    actor = actorOf("superadmin");

    const asc = await renderDeleted({ siteId, sort: "orderIndex:asc" });
    expect(asc.shifts.map((s) => s.id)).toEqual([ids[1], ids[0]]);

    const desc = await renderDeleted({ siteId, sort: "orderIndex:desc" });
    expect(desc.shifts.map((s) => s.id)).toEqual([ids[0], ids[1]]);
  });

  test("sort=label:asc orders by label; sort=deletedAt:asc by date", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "b", deletedAt: new Date("2026-02-01T10:00:00Z") },
      { suffix: "a", deletedAt: new Date("2026-03-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const byLabel = await renderDeleted({ siteId, sort: "label:asc" });
    expect(byLabel.shifts.map((s) => s.id)).toEqual([ids[1], ids[0]]);

    const byDate = await renderDeleted({ siteId, sort: "deletedAt:asc" });
    expect(byDate.shifts.map((s) => s.id)).toEqual([ids[0], ids[1]]);
  });

  test("shifts deleted at the same instant list by ascending id, whatever the insert order", async () => {
    const sameInstant = new Date("2026-01-01T10:00:00Z");
    const { siteId, ids } = await seedSiteWith(
      Array.from({ length: 4 }, (_, i) => ({
        suffix: `s${i}`,
        deletedAt: sameInstant,
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.shifts.map((s) => s.id)).toEqual([...ids].sort());
  });

  test("an HO sees only their own site's deleted shifts", async () => {
    const own = await seedSiteWith([
      { suffix: "own", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    const foreign = await seedSiteWith([
      { suffix: "foreign", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("ho", own.siteId);

    // A crafted siteId param must not widen the scope.
    const props = await renderDeleted({ siteId: foreign.siteId });

    expect(props.shifts.map((s) => s.id)).toEqual([own.ids[0]]);
  });

  test("an admin sees only the deleted shifts of their own location", async () => {
    const seeded = await seedSiteWith([
      { suffix: "mine", deletedAt: new Date("2026-01-01T10:00:00Z"), loc: "a" },
      {
        suffix: "sibling",
        deletedAt: new Date("2026-01-02T10:00:00Z"),
        loc: "b",
      },
    ]);
    actor = actorOf("admin", seeded.siteId, seeded.locA);

    const props = await renderDeleted({ q: seeded.token });

    expect(props.shifts.map((s) => s.id)).toEqual([seeded.ids[0]]);
  });

  test("an unbound HO and an unbound admin see nothing", async () => {
    for (const unbound of [actorOf("ho", null), actorOf("admin", null, null)]) {
      actor = unbound;

      const props = await renderDeleted();

      expect(props.shifts).toEqual([]);
      expect(props.total).toBe(0);
    }
  });

  test("pagination math holds in the deleted view", async () => {
    const { siteId } = await seedSiteWith(
      Array.from({ length: 12 }, (_, i) => ({
        suffix: String(i).padStart(2, "0"),
        deletedAt: new Date("2026-01-01T10:00:00Z"),
        orderIndex: 1,
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId, page: "999" });

    expect(props.total).toBe(12);
    expect(props.pageCount).toBe(2);
    expect(props.shifts).toHaveLength(2);
  });

  test("no show, an unknown show and a repeated show keep listing live shifts only", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null, orderIndex: 1 },
      {
        suffix: "gone",
        deletedAt: new Date("2026-01-01T10:00:00Z"),
        orderIndex: 2,
      },
    ]);
    actor = actorOf("superadmin");

    for (const show of [undefined, "bogus", "DELETED", ["deleted", "deleted"]]) {
      const props = await renderShifts({ siteId, show });
      expect(props.shifts.map((s) => s.id)).toEqual([ids[0]]);
    }
  });
});
