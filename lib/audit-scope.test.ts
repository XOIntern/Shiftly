import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { auditLog } from "../drizzle/schema";
import { auditLogListWhere } from "./audit-scope";
import { db } from "./db";
import { installCleanup } from "./test-cleanup";
import {
  seedAuditLog,
  seedLocation,
  seedSite,
  seedUser,
} from "./test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();

type Actor = Parameters<typeof auditLogListWhere>[0];

const actor = (overrides: Partial<Actor>): Actor => ({
  role: "admin",
  siteId: null,
  siteLocationId: null,
  ...overrides,
});

// The audit rows a viewer may read, run against real rows so the predicate
// itself is what is tested, not its text. Only a site-level ho (and the
// superadmin) reads the trail; an admin never does.
describe("auditLogListWhere", () => {
  async function seedTwoSites() {
    const siteA = await seedSite(cleanup);
    const siteB = await seedSite(cleanup);
    const locA = await seedLocation(cleanup, siteA.id);
    const author = await seedUser(cleanup, { role: "superadmin" });
    const rowA = await seedAuditLog(cleanup, {
      actorId: author.id,
      siteId: siteA.id,
      siteLocationId: locA.id,
    });
    const rowB = await seedAuditLog(cleanup, {
      actorId: author.id,
      siteId: siteB.id,
    });
    const rowGlobal = await seedAuditLog(cleanup, { actorId: author.id });
    return { siteA, siteB, locA, rowA, rowB, rowGlobal };
  }

  async function visibleAmong(
    candidates: string[],
    who: Actor,
  ): Promise<string[]> {
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(auditLogListWhere(who));
    const visible = new Set(rows.map((row) => row.id));
    return candidates.filter((id) => visible.has(id)).sort();
  }

  test("a superadmin sees every row, including one without a site", async () => {
    const f = await seedTwoSites();
    const all = [f.rowA.id, f.rowB.id, f.rowGlobal.id];

    expect(auditLogListWhere(actor({ role: "superadmin" }))).toBeUndefined();
    expect(await visibleAmong(all, actor({ role: "superadmin" }))).toEqual(
      [...all].sort(),
    );
  });

  test("an ho sees only their own site's rows, never one with a null site", async () => {
    const f = await seedTwoSites();
    const all = [f.rowA.id, f.rowB.id, f.rowGlobal.id];

    expect(
      await visibleAmong(all, actor({ role: "ho", siteId: f.siteA.id })),
    ).toEqual([f.rowA.id]);
  });

  test("an ho without a site sees nothing", async () => {
    const f = await seedTwoSites();

    expect(
      await visibleAmong(
        [f.rowA.id, f.rowB.id, f.rowGlobal.id],
        actor({ role: "ho" }),
      ),
    ).toEqual([]);
  });

  test("an admin sees nothing, even of their own site", async () => {
    const f = await seedTwoSites();

    expect(
      await visibleAmong(
        [f.rowA.id, f.rowB.id, f.rowGlobal.id],
        actor({ role: "admin", siteId: f.siteA.id, siteLocationId: f.locA.id }),
      ),
    ).toEqual([]);
  });
});
