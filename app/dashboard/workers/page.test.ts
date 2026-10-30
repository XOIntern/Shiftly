import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  position,
  site,
  siteLocation,
  worker,
  workerPosition,
} from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The workers page reads its actor through requireUser (all three roles
// manage their own scope) — swapped for a stub so the real server component
// can render against the test database. The mock swaps the WHOLE module
// across bun's single test process, so every export other suites may
// resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

type WorkerNode = {
  workers: Array<{
    id: string;
    employeeId: string;
    siteName: string;
    positions?: Array<{ id: string; name: string; isActive: boolean }>;
  }>;
  sites?: Array<{ id: string; name: string }>;
  siteLocations?: Array<{ id: string; name: string; siteId: string }>;
  positions?: Array<{ id: string; name: string; siteId: string; isActive: boolean }>;
  showSiteFilter?: boolean;
  pageCount?: number;
  total?: number;
};

// The page returns an RSC object tree; the workers travel to the client
// table as the workers/pageCount/total props on <WorkersTable>.
function collectWorkers(node: unknown, out: WorkerNode[]): WorkerNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectWorkers(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "workers" in props.props) {
    out.push(props.props as unknown as WorkerNode);
    collectWorkers(props.props.children, out);
  } else if (props.props) {
    collectWorkers(props.props.children, out);
  }
  return out;
}

async function renderWorkers(
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<WorkerNode> {
  const { default: WorkersPage } = await import("./page");
  const tree = await WorkersPage({
    searchParams: Promise.resolve(searchParams),
  } as never);
  const found = collectWorkers(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

// Shared fixture: site A (location LA1, the admin binding site) holds the
// live position PA plus the inactive PA-off; site B (location LB) holds PB
// and the worker W2. The workers W1/W2 sit under LA1/LB respectively. Site C
// is soft-deleted and holds the live+active position PC, which no picker may
// offer. Child-first cleanup.
async function seedWorkerFixtures() {
  const siteA = randomUUID();
  const siteB = randomUUID();
  const siteC = randomUUID();
  const locA1 = randomUUID();
  const locB = randomUUID();
  const locC = randomUUID();
  const posA = randomUUID();
  const posAOff = randomUUID();
  const posB = randomUUID();
  const posC = randomUUID();
  const wA = randomUUID();
  const wB = randomUUID();
  await db.insert(site).values([
    { id: siteA, name: `t13-wpage-site-a-${siteA}` },
    { id: siteB, name: `t13-wpage-site-b-${siteB}` },
    { id: siteC, name: `t13-wpage-site-c-${siteC}`, deletedAt: new Date() },
  ]);
  await db.insert(siteLocation).values([
    { id: locA1, siteId: siteA, name: `t13-wpage-loc-a1-${locA1}` },
    { id: locB, siteId: siteB, name: `t13-wpage-loc-b-${locB}` },
    { id: locC, siteId: siteC, name: `t13-wpage-loc-c-${locC}` },
  ]);
  // The site names embed their uuids, so site B is always alphabetically
  // after site A — the default [site, employeeId] order holds.
  await db.insert(position).values([
    { id: posA, siteId: siteA, name: "t13-wpage-alpha" },
    { id: posAOff, siteId: siteA, name: "t13-wpage-off", isActive: false },
    { id: posB, siteId: siteB, name: "t13-wpage-foreign-b" },
    { id: posC, siteId: siteC, name: "t13-wpage-soft-deleted-c" },
  ]);
  await db.insert(worker).values([
    {
      id: wA,
      siteId: siteA,
      siteLocationId: locA1,
      employeeId: `t13-wpage-emp-a-${wA.slice(0, 8)}`,
      name: "t13-wpage-worker-a",
    },
    {
      id: wB,
      siteId: siteB,
      siteLocationId: locB,
      employeeId: `t13-wpage-emp-b-${wB.slice(0, 8)}`,
      name: "t13-wpage-worker-b",
    },
  ]);
  // Multi-position spec (2026-10-20): every worker's qualification set lives
  // in the pivot, so each seeded worker gets its row.
  await db.insert(workerPosition).values([
    { workerId: wA, positionId: posA, siteId: siteA },
    { workerId: wB, positionId: posB, siteId: siteB },
  ]);
  return {
    ids: {
      siteA,
      siteB,
      siteC,
      locA1,
      locB,
      locC,
      posA,
      posAOff,
      posB,
      posC,
      wA,
      wB,
    },
    async cleanup() {
      // Child-first: the pivot rows hold the RESTRICT composite FKs.
      await db.delete(workerPosition).where(eq(workerPosition.workerId, wA));
      await db.delete(workerPosition).where(eq(workerPosition.workerId, wB));
      await db.delete(worker).where(eq(worker.id, wA));
      await db.delete(worker).where(eq(worker.id, wB));
      await db.delete(position).where(eq(position.id, posA));
      await db.delete(position).where(eq(position.id, posAOff));
      await db.delete(position).where(eq(position.id, posB));
      await db.delete(position).where(eq(position.id, posC));
      await db.delete(siteLocation).where(eq(siteLocation.id, locA1));
      await db.delete(siteLocation).where(eq(siteLocation.id, locB));
      await db.delete(siteLocation).where(eq(siteLocation.id, locC));
      await db.delete(site).where(eq(site.id, siteA));
      await db.delete(site).where(eq(site.id, siteB));
      await db.delete(site).where(eq(site.id, siteC));
    },
  };
}

function makeActor(
  role: SessionUser["role"],
  siteId: string | null,
  siteLocationId: string | null,
): SessionUser {
  return {
    id: randomUUID(),
    name: "T13 Worker Actor",
    email: `t13-wpage-${randomUUID()}@shiftly.test`,
    role,
    siteId,
    siteLocationId,
    isActive: true,
  };
}

// t13- prefixed real-DB fixtures; uuid slices keep suites collision-free.
describe("workers page server queries", () => {
  test("admin sees only workers in their binding location", async () => {
    const fx = await seedWorkerFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("admin", null, fx.ids.locA1);

    const page = await renderWorkers();
    expect(page.workers.map((w) => w.id)).toEqual([fx.ids.wA]);
    expect(page.total).toBe(1);
  });

  test("ho sees all workers under their site, not other sites'", async () => {
    const fx = await seedWorkerFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    // A crafted siteId param is ignored for a ho — scope is data-level.
    const crafted = await renderWorkers({ siteId: fx.ids.siteB });
    expect(crafted.workers.map((w) => w.id)).toEqual([fx.ids.wA]);
    expect(crafted.total).toBe(1);
  });

  test("superadmin siteId filter keeps only that site's workers; junk shows all", async () => {
    const fx = await seedWorkerFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const filtered = await renderWorkers({ siteId: fx.ids.siteA });
    expect(filtered.workers.map((w) => w.id)).toEqual([fx.ids.wA]);
    expect(filtered.total).toBe(1);

    // Shared dev DB: the unfiltered list is paginated and sorted by site
    // name, so unrelated workers can fill page 1 and push the fixtures off
    // it. The employee-id search narrows the junk render to the fixtures'
    // own rows, and it still spans both sites.
    const junk = await renderWorkers({
      siteId: "junk" as never,
      q: "t13-wpage-emp",
    });
    const junkIds = junk.workers.map((w) => w.id);
    expect(junkIds).toContain(fx.ids.wA);
    expect(junkIds).toContain(fx.ids.wB);
  });

  test("dialog receives the role-scoped site, location, and position options", async () => {
    const fx = await seedWorkerFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("ho", fx.ids.siteA, null);

    const page = await renderWorkers();
    // CreateWorkerButton and WorkersTable receive the same fixture
    // props, asserted on the table node.
    expect(page.sites?.map((s) => s.id)).toEqual([fx.ids.siteA]);
    expect(
      (page.siteLocations ?? []).every((l) => l.siteId === fx.ids.siteA),
    ).toBe(true);
    expect(page.siteLocations?.map((l) => l.id)).toEqual([fx.ids.locA1]);
    // Options are live (inactive included, so an attached inactive
    // position can be rendered and removed); site B's is scoped out.
    const positionIds = (page.positions ?? []).map((p) => p.id);
    expect(positionIds).toEqual([fx.ids.posA, fx.ids.posAOff]);
    expect(
      (page.positions ?? []).every((p) => p.siteId === fx.ids.siteA),
    ).toBe(true);
  });

  test("pickers exclude positions under a soft-deleted site", async () => {
    const fx = await seedWorkerFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const page = await renderWorkers({ pageSize: "50" });
    const positionIds = (page.positions ?? []).map((p) => p.id);
    // Shared dev DB: other suites' live positions may exist, so assert
    // presence rather than an exact array.
    expect(positionIds).toContain(fx.ids.posA);
    expect(positionIds).not.toContain(fx.ids.posC);
  });

  test("unbound admin sees nothing", async () => {
    const fx = await seedWorkerFixtures();
    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("admin", null, null);

    const page = await renderWorkers();
    expect(page.workers).toEqual([]);
    expect(page.total).toBe(0);
  });
  test("each row carries its positions sorted by name", async () => {
    const fx = await seedWorkerFixtures();
    const aaa = randomUUID();

    fixtureCleanup.defer(async () => {
      // The local position (and its pivot row) go before the site dies.
      await db
        .delete(workerPosition)
        .where(eq(workerPosition.positionId, aaa));
      await db.delete(position).where(eq(position.id, aaa));
      await fx.cleanup();
    });
    await db.insert(position).values({
      id: aaa,
      siteId: fx.ids.siteA,
      name: "t13-wpage-aaa",
    });
    await db.insert(workerPosition).values({
      workerId: fx.ids.wA,
      positionId: aaa,
      siteId: fx.ids.siteA,
    });

    actor = makeActor("superadmin", null, null);

    const page = await renderWorkers({ siteId: fx.ids.siteA });
    const row = page.workers.find((w) => w.id === fx.ids.wA);
    expect(row?.positions?.map((p) => p.name)).toEqual([
      "t13-wpage-aaa",
      "t13-wpage-alpha",
    ]);
  });

  test("a worker with no pivot rows renders an empty positions list", async () => {
    const fx = await seedWorkerFixtures();
    const bare = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.id, bare));
      await fx.cleanup();
    });
    await db.insert(worker).values({
      id: bare,
      siteId: fx.ids.siteA,
      siteLocationId: fx.ids.locA1,
      employeeId: `t13-wpage-emp-bare-${bare.slice(0, 8)}`,
      name: "t13-wpage-worker-bare",
    });

    actor = makeActor("superadmin", null, null);

    const page = await renderWorkers({ siteId: fx.ids.siteA });
    const row = page.workers.find((w) => w.id === bare);
    expect(row).toBeDefined();
    expect(row?.positions).toEqual([]);
  });

  test("position options include inactive positions", async () => {
    const fx = await seedWorkerFixtures();

    fixtureCleanup.defer(async () => {
      await fx.cleanup();
    });
    actor = makeActor("superadmin", null, null);

    const page = await renderWorkers({ pageSize: "50" });
    const positionIds = (page.positions ?? []).map((p) => p.id);
    expect(positionIds).toContain(fx.ids.posAOff);
  });
});

// The deleted view (?show=deleted) lists soft-deleted workers inside the
// actor's scope; every other value of show is the live list.
describe("workers page deleted view", () => {
  type DeletedRow = {
    id: string;
    employeeId: string;
    name: string;
    siteName: string;
    locationName: string;
    deletedAt: string;
  };

  function actorOf(
    role: SessionUser["role"],
    siteId: string | null = null,
    siteLocationId: string | null = null,
  ): SessionUser {
    return {
      id: randomUUID(),
      name: "Worker Deleted Actor",
      email: `t192-page-${randomUUID()}@shiftly.test`,
      role,
      siteId,
      siteLocationId,
      isActive: true,
    };
  }

  async function renderDeleted(
    searchParams: Record<string, string | string[] | undefined> = {},
  ) {
    const props = await renderWorkers({ show: "deleted", ...searchParams });
    return { ...props, workers: props.workers as unknown as DeletedRow[] };
  }

  // One site with two locations and workers seeded straight into the table so
  // each row can carry its own deletedAt. The site name doubles as the
  // search token; `loc` picks which location a worker goes under.
  async function seedSiteWith(
    rows: Array<{
      suffix: string;
      deletedAt: Date | null;
      isActive?: boolean;
      loc?: "a" | "b";
      name?: string;
    }>,
  ) {
    const siteId = randomUUID();
    const locA = randomUUID();
    const locB = randomUUID();
    const token = `t192-page-${randomUUID().slice(0, 8)}`;
    fixtureCleanup.defer(async () => {
      await db.delete(worker).where(eq(worker.siteId, siteId));
      await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: token });
    await db.insert(siteLocation).values([
      { id: locA, siteId, name: `${token}-loc-a` },
      { id: locB, siteId, name: `${token}-loc-b` },
    ]);
    const ids = rows.map(() => randomUUID());
    await db.insert(worker).values(
      rows.map((row, i) => ({
        id: ids[i],
        siteId,
        siteLocationId: row.loc === "b" ? locB : locA,
        employeeId: `${token}-${row.suffix}`,
        name: row.name ?? `Name ${row.suffix}`,
        isActive: row.isActive ?? true,
        deletedAt: row.deletedAt,
      })),
    );
    return { siteId, locA, locB, token, ids };
  }

  test("lists only soft-deleted workers, newest deletion first, with location and date", async () => {
    const { siteId, token, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "older", deletedAt: new Date("2026-01-01T10:00:00Z") },
      { suffix: "newer", deletedAt: new Date("2026-02-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.workers.map((w) => w.id)).toEqual([ids[2], ids[1]]);
    expect(props.workers[0].deletedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(props.workers[0].siteName).toBe(token);
    expect(props.workers[0].locationName).toBe(`${token}-loc-a`);
    expect(props.total).toBe(2);
  });

  test("q matches the name or the employee id within the deleted view", async () => {
    const { token, ids } = await seedSiteWith([
      {
        suffix: "one",
        deletedAt: new Date("2026-01-01T10:00:00Z"),
        name: "Budi Santoso",
      },
      {
        suffix: "two",
        deletedAt: new Date("2026-01-02T10:00:00Z"),
        name: "Siti Aminah",
      },
    ]);
    actor = actorOf("superadmin");

    const byId = await renderDeleted({ q: `${token}-one` });
    expect(byId.workers.map((w) => w.id)).toEqual([ids[0]]);

    const byName = await renderDeleted({ q: "Aminah", siteId: undefined });
    expect(byName.workers.map((w) => w.id)).toContain(ids[1]);
    expect(byName.workers.map((w) => w.id)).not.toContain(ids[0]);
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

    expect(inactive.workers.map((w) => w.id)).toEqual([ids[1]]);
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

    expect(props.workers.map((w) => w.id)).toEqual([a.ids[0]]);
    expect(props.workers.map((w) => w.id)).not.toContain(b.ids[0]);
  });

  test("sort=employeeId:asc orders by employee id; sort=deletedAt:asc by date", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "b", deletedAt: new Date("2026-02-01T10:00:00Z") },
      { suffix: "a", deletedAt: new Date("2026-03-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    const byId = await renderDeleted({ siteId, sort: "employeeId:asc" });
    expect(byId.workers.map((w) => w.id)).toEqual([ids[1], ids[0]]);

    const byDate = await renderDeleted({ siteId, sort: "deletedAt:asc" });
    expect(byDate.workers.map((w) => w.id)).toEqual([ids[0], ids[1]]);
  });

  test("workers deleted at the same instant list by ascending id, whatever the insert order", async () => {
    const sameInstant = new Date("2026-01-01T10:00:00Z");
    const { siteId, ids } = await seedSiteWith(
      Array.from({ length: 4 }, (_, i) => ({
        suffix: `s${i}`,
        deletedAt: sameInstant,
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId });

    expect(props.workers.map((w) => w.id)).toEqual([...ids].sort());
  });

  test("an HO sees only their own site's deleted workers", async () => {
    const own = await seedSiteWith([
      { suffix: "own", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    const foreign = await seedSiteWith([
      { suffix: "foreign", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("ho", own.siteId);

    // A crafted siteId param must not widen the scope.
    const props = await renderDeleted({ siteId: foreign.siteId });

    expect(props.workers.map((w) => w.id)).toEqual([own.ids[0]]);
  });

  test("an admin sees only the deleted workers of their own location", async () => {
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

    expect(props.workers.map((w) => w.id)).toEqual([seeded.ids[0]]);
  });

  test("an unbound HO and an unbound admin see nothing", async () => {
    for (const unbound of [actorOf("ho", null), actorOf("admin", null, null)]) {
      actor = unbound;

      const props = await renderDeleted();

      expect(props.workers).toEqual([]);
      expect(props.total).toBe(0);
    }
  });

  test("pagination math holds in the deleted view", async () => {
    const { siteId } = await seedSiteWith(
      Array.from({ length: 12 }, (_, i) => ({
        suffix: String(i).padStart(2, "0"),
        deletedAt: new Date("2026-01-01T10:00:00Z"),
      })),
    );
    actor = actorOf("superadmin");

    const props = await renderDeleted({ siteId, page: "999" });

    expect(props.total).toBe(12);
    expect(props.pageCount).toBe(2);
    expect(props.workers).toHaveLength(2);
  });

  test("no show, an unknown show and a repeated show keep listing live workers only", async () => {
    const { siteId, ids } = await seedSiteWith([
      { suffix: "live", deletedAt: null },
      { suffix: "gone", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    actor = actorOf("superadmin");

    for (const show of [undefined, "bogus", "DELETED", ["deleted", "deleted"]]) {
      const props = await renderWorkers({ siteId, show });
      expect(props.workers.map((w) => w.id)).toEqual([ids[0]]);
    }
  });
});
