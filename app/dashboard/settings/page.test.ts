import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { rosterRuleConfig, site, siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// The settings page reads its actor through requireUser — swapped for a
// stub so the real server component can render against the test database.
// The mock swaps the WHOLE module across bun's single test process, so
// every export other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

type RuleRowView = {
  key: string;
  meaning: string;
  kind: "int" | "bool";
  value: number | boolean;
  source: string;
  note?: string;
};

type RulesNode = {
  rows: RuleRowView[];
  locations: Array<{ id: string; name: string }>;
  role: string;
  canEdit: boolean;
};

// The page returns an RSC object tree; the resolved rules travel to the
// client table as the rows/locations/role/canEdit props on <RuleConfigTable>.
function collectRules(node: unknown, out: RulesNode[]): RulesNode[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectRules(child, out);
    return out;
  }
  const props = node as { props?: Record<string, unknown> };
  if (props.props && "rows" in props.props) {
    out.push(props.props as unknown as RulesNode);
  }
  if (props.props) collectRules(props.props.children, out);
  return out;
}

async function renderSettings(): Promise<RulesNode> {
  const { default: SettingsPage } = await import("./page");
  const tree = await SettingsPage();
  const found = collectRules(tree, []);
  expect(found.length).toBe(1);
  return found[0];
}

async function seedSite(): Promise<string> {
  const id = randomUUID();
  await db.insert(site).values({ id, name: `t6-rules-site-${id}` });
  return id;
}

async function seedLocation(siteId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(siteLocation).values({ id, siteId, name });
  return id;
}

// Config rows reference sites/locations with restrict FKs — config rows
// first, then locations, then sites.
async function cleanup(siteIds: string[]) {
  for (const siteId of siteIds) {
    await db
      .delete(rosterRuleConfig)
      .where(eq(rosterRuleConfig.siteId, siteId));
  }
  for (const siteId of siteIds) {
    await db.delete(siteLocation).where(eq(siteLocation.siteId, siteId));
    await db.delete(site).where(eq(site.id, siteId));
  }
}

function row(rows: RuleRowView[], key: string): RuleRowView {
  const found = rows.find((r) => r.key === key);
  expect(found).toBeDefined();
  return found!;
}

// t6- prefixed real-DB fixtures: uuid slices keep suites collision-free on
// the shared dev DB.
describe("settings roster rules card (issue #53)", () => {
  test("ho sees the seven rules with effective values, source labels, and edit controls", async () => {
    const siteA = await seedSite();
    const locA = await seedLocation(siteA, `t6-rules-loc-a-${randomUUID().slice(0, 6)}`);
    const locB = await seedLocation(siteA, `t6-rules-loc-b-${randomUUID().slice(0, 6)}`);
    const globalId = randomUUID();
    fixtureCleanup.defer(async () => {
      await db.delete(rosterRuleConfig).where(eq(rosterRuleConfig.id, globalId));
      await cleanup([siteA]);
    });
    // Global base row for C1; site override for C2 on the ho's own site.
    await db.insert(rosterRuleConfig).values([
      { id: globalId, ruleKey: "C1", intValue: 5 },
      { id: randomUUID(), ruleKey: "C2", siteId: siteA, intValue: 18 },
    ]);

    actor = {
      id: randomUUID(),
      name: "T6 Rules Ho",
      email: `t6-rules-${randomUUID()}@shiftly.test`,
      role: "ho",
      siteId: siteA,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSettings();

    expect(props.canEdit).toBe(true);
    expect(props.role).toBe("ho");
    expect(props.rows).toHaveLength(7);
    // Every row carries a meaning and a valid source label.
    for (const r of props.rows) {
      expect(r.meaning.length).toBeGreaterThan(0);
      expect(["default", "global", "site", "location"]).toContain(r.source);
      expect(["int", "bool"]).toContain(r.kind);
    }
    // After the renumber the rule set is C1–C7 and C7 is the work
    // qualification rule — the old work-area rule is gone from the table
    // entirely. The engine check is dormant until qualification data
    // exists, so the row carries that caveat alongside the pinned meaning.
    expect(row(props.rows, "C7")).toEqual({
      key: "C7",
      meaning: "Work qualification match",
      kind: "bool",
      // Shared dev DB: a stray global C7 row may exist, so the effective
      // value and source are asserted as base scopes, not pinned literals.
      value: expect.any(Boolean),
      source: expect.any(String),
      note: "Dormant until worker qualifications are recorded",
    });
    expect(["default", "global"]).toContain(row(props.rows, "C7").source);
    // No work-area rule survives the renumber, by meaning or by key.
    expect(
      props.rows.find((r) => r.meaning === "Work area match"),
    ).toBeUndefined();
    expect(props.rows.find((r) => r.key === "C8")).toBeUndefined();
    // Most-specific-wins: global row wins C1, the ho's site row wins C2.
    expect(row(props.rows, "C1")).toEqual({
      key: "C1",
      meaning: expect.any(String),
      kind: "int",
      value: 5,
      source: "global",
    });
    expect(row(props.rows, "C2")).toEqual({
      key: "C2",
      meaning: expect.any(String),
      kind: "int",
      value: 18,
      source: "site",
    });
    // The location dropdown is limited to the actor's own site.
    expect(props.locations.map((l) => l.id).sort()).toEqual([locA, locB].sort());
  });

  test("admin sees effective rules read-only — no edit controls", async () => {
    const siteA = await seedSite();
    const locA = await seedLocation(siteA, `t6-rules-admin-loc-${randomUUID().slice(0, 6)}`);
    fixtureCleanup.defer(async () => {
      await cleanup([siteA]);
    });
    // Location-level override for C1 under the admin's own location.
    await db.insert(rosterRuleConfig).values({
      id: randomUUID(),
      ruleKey: "C1",
      siteId: siteA,
      siteLocationId: locA,
      intValue: 7,
    });

    actor = {
      id: randomUUID(),
      name: "T6 Rules Admin",
      email: `t6-rules-${randomUUID()}@shiftly.test`,
      role: "admin",
      siteId: null,
      siteLocationId: locA,
      isActive: true,
    };
    const props = await renderSettings();

    expect(props.canEdit).toBe(false);
    expect(props.role).toBe("admin");
    expect(props.rows).toHaveLength(7);
    // The admin still sees real effective values — the location row wins.
    expect(row(props.rows, "C1").value).toBe(7);
    expect(row(props.rows, "C1").source).toBe("location");
  });

  test("a null-bound ho renders defaults instead of crashing", async () => {
    actor = {
      id: randomUUID(),
      name: "T6 Ho Unbound",
      email: `t6-rules-${randomUUID()}@shiftly.test`,
      role: "ho",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSettings();

    expect(props.canEdit).toBe(true);
    expect(props.rows).toHaveLength(7);
    for (const r of props.rows) {
      // No site to hang rows on: only the global base or the default.
      expect(["default", "global"]).toContain(r.source);
    }
    expect(props.locations).toEqual([]);
  });

  test("a superadmin renders the global base view with edit controls and every site's locations", async () => {
    const siteA = await seedSite();
    const locA = await seedLocation(siteA, `t6-rules-sa-loc-${randomUUID().slice(0, 6)}`);
    fixtureCleanup.defer(async () => {
      await cleanup([siteA]);
    });
    actor = {
      id: randomUUID(),
      name: "T6 Super",
      email: `t6-rules-${randomUUID()}@shiftly.test`,
      role: "superadmin",
      siteId: null,
      siteLocationId: null,
      isActive: true,
    };
    const props = await renderSettings();

    expect(props.canEdit).toBe(true);
    expect(props.role).toBe("superadmin");
    expect(props.rows).toHaveLength(7);
    for (const r of props.rows) {
      expect(["default", "global"]).toContain(r.source);
    }
    // No site of their own, but every live location is a writable target
    // — shared dev DB, so assert presence of the fixture rather than the
    // full list.
    expect(props.locations.map((l) => l.id)).toContain(locA);
  });
});
