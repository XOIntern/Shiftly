import "dotenv/config";
import { inArray, like, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../drizzle/schema";

const {
  auditLog,
  mpRequest,
  position,
  rosterPlan,
  rosterRuleConfig,
  shiftDefinition,
  site,
  siteLocation,
  user,
  worker,
  workArea,
} = schema;

// Removes fixture rows that db-backed test suites left behind before their
// cleanup was made failure-proof. Dry run by default: it prints the target
// database and every matched row, flagged with whatever still references it
// (its blockers). Only `--yes` deletes, and only the rows without blockers,
// in one transaction, in foreign-key order; blocked rows are skipped and
// listed. A database error still rolls the whole transaction back.
//
// Matching is exact: a known test prefix AND a random uuid suffix (never an
// e-mail domain), so hand-made rows that merely look similar are left alone.
//
// Out of scope: the `t-mp-*` (requests/actions.test.ts) and
// `t-roster-t4-dd-*` fixture graphs. Their users own requests, plans and
// workers, so removing them means deleting operational rows, not just
// fixture identities; this script does not match them.
//
// The database URL is validated before any connection is made: a missing,
// unparseable or unexpanded (`${...}`) DATABASE_URL exits 1, because the pg
// driver would otherwise fall back to PG* variables or the local OS user.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const FIXTURE_PATTERNS = {
  // locations/bulk.test.ts: the foreign site of the deleteBulk test.
  siteName: [new RegExp(`^t4-loc-fs-${UUID}$`)],
  // lib/auth-rbac-guard.test.ts actors.
  userEmail: [new RegExp(`^auth-guard-${UUID}@shiftly\\.test$`)],
} as const;

// SQL LIKE prefilters; the regexes above make the final call.
const SITE_PREFIXES = ["t4-loc-fs-%"];
const USER_EMAIL_PREFIXES = ["auth-guard-%"];

// Every ON DELETE RESTRICT foreign key into site, site_location or user, by
// constraint name (drizzle/schema). Each one is checked below; the db test
// compares this list with the live catalog so a new FK cannot slip past.
// session/account cascade from user and need no check.
export const CHECKED_RESTRICT_FKS = [
  "audit_log_actor_id_user_id_fk", // deleted along with a deletable actor
  "audit_log_site_id_site_id_fk",
  "audit_log_site_location_id_site_location_id_fk",
  "mp_request_created_by_user_fk",
  "mp_request_site_location_site_fk",
  "position_site_id_site_id_fk",
  "roster_plan_generated_by_user_fk",
  "roster_plan_published_by_user_fk",
  "roster_plan_site_location_site_fk",
  "roster_rule_config_site_id_site_id_fk",
  "roster_rule_config_site_location_id_site_location_id_fk",
  "shift_definition_site_location_site_fk",
  "site_location_site_id_site_id_fk", // locations go with their site
  "user_site_id_site_id_fk",
  "user_site_location_id_site_location_id_fk",
  "work_area_site_location_site_fk",
  "worker_site_location_site_fk",
] as const;

export function isFixtureSiteName(name: string): boolean {
  return FIXTURE_PATTERNS.siteName.some((pattern) => pattern.test(name));
}

export function isFixtureUserEmail(email: string): boolean {
  return FIXTURE_PATTERNS.userEmail.some((pattern) => pattern.test(email));
}

export type UrlCheck =
  | { ok: true; target: string }
  | { ok: false; error: string };

// host:port/dbname only — never the user or password.
export function describeDatabaseUrl(url: string | undefined): UrlCheck {
  if (!url || url.trim() === "") {
    return { ok: false, error: "DATABASE_URL is not set" };
  }
  if (url.includes("${")) {
    return {
      ok: false,
      error: "DATABASE_URL contains an unexpanded ${...} reference",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "DATABASE_URL is not a parseable URL" };
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return { ok: false, error: "DATABASE_URL is not a postgres URL" };
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !name) {
    return { ok: false, error: "DATABASE_URL lacks a host or database name" };
  }
  return {
    ok: true,
    target: `${parsed.hostname}:${parsed.port || "5432"}/${name}`,
  };
}

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type FixtureRow = {
  kind: "site" | "user";
  id: string;
  label: string;
  createdAt: Date;
  // "table.column (n)" per referencing source; empty = deletable.
  blockers: string[];
};

export type CleanupPlan = {
  rows: FixtureRow[];
  // Rows that go with the deletable ones.
  auditIds: string[];
  locationIds: string[];
};

export type CleanupOptions = {
  // Allow-list of site/user ids: only these can match. Tests always pass it.
  onlyIds?: readonly string[];
};

// One row that references a candidate. `removableWithUser` marks a source
// row that is itself deleted when that matched user is deleted (the user's
// own binding, or an audit row the user wrote).
type Reference = {
  source: string;
  targetKind: "site" | "user";
  targetId: string;
  removableWithUser?: string;
};

async function findCandidates(tx: Tx, options: CleanupOptions) {
  const allow = options.onlyIds ? new Set(options.onlyIds) : null;
  const allowed = (id: string) => allow === null || allow.has(id);

  const sites = (
    await tx
      .select({ id: site.id, label: site.name, createdAt: site.createdAt })
      .from(site)
      .where(or(...SITE_PREFIXES.map((prefix) => like(site.name, prefix))))
  ).filter((row) => isFixtureSiteName(row.label) && allowed(row.id));
  const users = (
    await tx
      .select({ id: user.id, label: user.email, createdAt: user.createdAt })
      .from(user)
      .where(
        or(...USER_EMAIL_PREFIXES.map((prefix) => like(user.email, prefix))),
      )
  ).filter((row) => isFixtureUserEmail(row.label) && allowed(row.id));
  return { sites, users };
}

async function findReferences(
  tx: Tx,
  siteIds: string[],
  userIds: string[],
): Promise<{ refs: Reference[]; locationSite: Map<string, string> }> {
  const refs: Reference[] = [];

  if (userIds.length > 0) {
    for (const row of await tx
      .select({ target: mpRequest.createdBy })
      .from(mpRequest)
      .where(inArray(mpRequest.createdBy, userIds))) {
      refs.push({
        source: "mp_request.created_by",
        targetKind: "user",
        targetId: row.target,
      });
    }
    for (const row of await tx
      .select({
        generatedBy: rosterPlan.generatedBy,
        publishedBy: rosterPlan.publishedBy,
      })
      .from(rosterPlan)
      .where(
        or(
          inArray(rosterPlan.generatedBy, userIds),
          inArray(rosterPlan.publishedBy, userIds),
        ),
      )) {
      if (row.generatedBy && userIds.includes(row.generatedBy)) {
        refs.push({
          source: "roster_plan.generated_by",
          targetKind: "user",
          targetId: row.generatedBy,
        });
      }
      if (row.publishedBy && userIds.includes(row.publishedBy)) {
        refs.push({
          source: "roster_plan.published_by",
          targetKind: "user",
          targetId: row.publishedBy,
        });
      }
    }
  }

  const locationSite = new Map<string, string>();
  if (siteIds.length === 0) return { refs, locationSite };

  for (const row of await tx
    .select({ id: siteLocation.id, siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(inArray(siteLocation.siteId, siteIds))) {
    locationSite.set(row.id, row.siteId);
  }
  const locationIds = [...locationSite.keys()];

  // References to a matched site.
  for (const row of await tx
    .select({ id: user.id, target: user.siteId })
    .from(user)
    .where(inArray(user.siteId, siteIds))) {
    refs.push({
      source: "user.site_id",
      targetKind: "site",
      targetId: row.target!,
      removableWithUser: row.id,
    });
  }
  for (const row of await tx
    .select({ actor: auditLog.actorId, target: auditLog.siteId })
    .from(auditLog)
    .where(inArray(auditLog.siteId, siteIds))) {
    refs.push({
      source: "audit_log.site_id",
      targetKind: "site",
      targetId: row.target!,
      removableWithUser: row.actor,
    });
  }
  for (const [source, column] of [
    ["position.site_id", position.siteId],
    ["roster_rule_config.site_id", rosterRuleConfig.siteId],
  ] as const) {
    for (const row of await tx
      .select({ target: column })
      .from(column.table)
      .where(inArray(column, siteIds))) {
      refs.push({ source, targetKind: "site", targetId: row.target! });
    }
  }

  // References to a location of a matched site block that site.
  if (locationIds.length === 0) return { refs, locationSite };
  for (const row of await tx
    .select({ id: user.id, target: user.siteLocationId })
    .from(user)
    .where(inArray(user.siteLocationId, locationIds))) {
    refs.push({
      source: "user.site_location_id",
      targetKind: "site",
      targetId: locationSite.get(row.target!)!,
      removableWithUser: row.id,
    });
  }
  for (const row of await tx
    .select({ actor: auditLog.actorId, target: auditLog.siteLocationId })
    .from(auditLog)
    .where(inArray(auditLog.siteLocationId, locationIds))) {
    refs.push({
      source: "audit_log.site_location_id",
      targetKind: "site",
      targetId: locationSite.get(row.target!)!,
      removableWithUser: row.actor,
    });
  }
  for (const [source, column] of [
    ["roster_rule_config.site_location_id", rosterRuleConfig.siteLocationId],
    ["mp_request.site_location_id", mpRequest.siteLocationId],
    ["roster_plan.site_location_id", rosterPlan.siteLocationId],
    ["worker.site_location_id", worker.siteLocationId],
    ["work_area.site_location_id", workArea.siteLocationId],
    ["shift_definition.site_location_id", shiftDefinition.siteLocationId],
  ] as const) {
    for (const row of await tx
      .select({ target: column })
      .from(column.table)
      .where(inArray(column, locationIds))) {
      refs.push({
        source,
        targetKind: "site",
        targetId: locationSite.get(row.target!)!,
      });
    }
  }
  return { refs, locationSite };
}

function summarize(refs: Reference[]): string[] {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref.source, (counts.get(ref.source) ?? 0) + 1);
  }
  return [...counts].map(([source, n]) => `${source} (${n})`);
}

// Finds the matched rows and what blocks each one. A reference from a row
// that is deleted anyway (a deletable matched user, or an audit row such a
// user wrote) does not block; when a user turns out blocked, the rows it
// would have taken along block in turn, hence the loop.
export async function planCleanup(
  tx: Tx,
  options: CleanupOptions = {},
): Promise<CleanupPlan> {
  const { sites, users } = await findCandidates(tx, options);
  const { refs, locationSite } = await findReferences(
    tx,
    sites.map((row) => row.id),
    users.map((row) => row.id),
  );

  const deletableUsers = new Set(users.map((row) => row.id));
  const deletableSites = new Set(sites.map((row) => row.id));
  const blockersOf = (kind: "site" | "user", id: string) =>
    refs.filter(
      (ref) =>
        ref.targetKind === kind &&
        ref.targetId === id &&
        !(
          ref.removableWithUser !== undefined &&
          deletableUsers.has(ref.removableWithUser)
        ),
    );

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...deletableUsers]) {
      if (blockersOf("user", id).length > 0) {
        deletableUsers.delete(id);
        changed = true;
      }
    }
    for (const id of [...deletableSites]) {
      if (blockersOf("site", id).length > 0) {
        deletableSites.delete(id);
        changed = true;
      }
    }
  }

  const rows: FixtureRow[] = [
    ...sites.map((row) => ({
      kind: "site" as const,
      ...row,
      blockers: summarize(blockersOf("site", row.id)),
    })),
    ...users.map((row) => ({
      kind: "user" as const,
      ...row,
      blockers: summarize(blockersOf("user", row.id)),
    })),
  ];

  const auditIds =
    deletableUsers.size > 0
      ? (
          await tx
            .select({ id: auditLog.id })
            .from(auditLog)
            .where(inArray(auditLog.actorId, [...deletableUsers]))
        ).map((row) => row.id)
      : [];
  const locationIds = [...locationSite]
    .filter(([, siteId]) => deletableSites.has(siteId))
    .map(([id]) => id);

  return { rows, auditIds, locationIds };
}

// Dry run: the plan, read in a transaction that writes nothing.
export async function inspectFixtures(
  db: Db,
  options: CleanupOptions = {},
): Promise<CleanupPlan> {
  return db.transaction((tx) => planCleanup(tx, options));
}

// Deletes the unblocked rows of a fresh plan, all in one transaction.
export async function deleteUnblockedFixtures(
  db: Db,
  options: CleanupOptions = {},
): Promise<CleanupPlan> {
  return db.transaction(async (tx) => {
    const plan = await planCleanup(tx, options);
    const free = (kind: "site" | "user") =>
      plan.rows
        .filter((row) => row.kind === kind && row.blockers.length === 0)
        .map((row) => row.id);
    const userIds = free("user");
    const siteIds = free("site");

    if (plan.auditIds.length > 0) {
      await tx.delete(auditLog).where(inArray(auditLog.id, plan.auditIds));
    }
    if (userIds.length > 0) {
      await tx.delete(user).where(inArray(user.id, userIds));
    }
    if (plan.locationIds.length > 0) {
      await tx
        .delete(siteLocation)
        .where(inArray(siteLocation.id, plan.locationIds));
    }
    if (siteIds.length > 0) {
      await tx.delete(site).where(inArray(site.id, siteIds));
    }
    return plan;
  });
}

const PRINT_LIMIT = 200;

function formatRow(row: FixtureRow): string {
  const status =
    row.blockers.length === 0
      ? "deletable"
      : `BLOCKED by ${row.blockers.join(", ")}`;
  return `${row.kind}  ${row.label}  id=${row.id}  created_at=${row.createdAt.toISOString()}  ${status}`;
}

function printRows(rows: FixtureRow[]) {
  for (const row of rows.slice(0, PRINT_LIMIT)) console.log(`  ${formatRow(row)}`);
  if (rows.length > PRINT_LIMIT) {
    console.log(`  ... and ${rows.length - PRINT_LIMIT} more not shown`);
  }
}

function printSummary(plan: CleanupPlan) {
  const count = (kind: "site" | "user") => {
    const all = plan.rows.filter((row) => row.kind === kind);
    const blocked = all.filter((row) => row.blockers.length > 0).length;
    return `${all.length} ${kind}(s), ${blocked} blocked`;
  };
  console.log(`Matched: ${count("site")}; ${count("user")}`);
  console.log(
    `Taken along with the deletable rows: ${plan.locationIds.length} site_location, ${plan.auditIds.length} audit_log (account/session cascade)`,
  );
}

async function main(): Promise<number> {
  const check = describeDatabaseUrl(process.env.DATABASE_URL);
  if (!check.ok) {
    console.error(`Refusing to run: ${check.error}. Nothing was touched.`);
    return 1;
  }
  console.log(`Target database: ${check.target}`);
  const apply = process.argv.slice(2).includes("--yes");

  // Imported only now, so a bad URL never reaches the pg driver.
  const { db } = await import("../lib/db");
  try {
    if (!apply) {
      const plan = await inspectFixtures(db);
      printSummary(plan);
      printRows(plan.rows);
      const free = plan.rows.filter((row) => row.blockers.length === 0);
      console.log(
        `Dry run: nothing deleted. --yes would delete ${free.length} row(s) and skip ${plan.rows.length - free.length} blocked row(s).`,
      );
      return 0;
    }

    let plan: CleanupPlan;
    try {
      plan = await deleteUnblockedFixtures(db);
    } catch (error) {
      console.error(
        "Rolled back, nothing deleted:",
        error instanceof Error ? error.message : error,
      );
      return 1;
    }
    const deleted = plan.rows.filter((row) => row.blockers.length === 0);
    const skipped = plan.rows.filter((row) => row.blockers.length > 0);
    printSummary(plan);
    console.log(`Deleted ${deleted.length} row(s):`);
    printRows(deleted);
    console.log(`Skipped ${skipped.length} blocked row(s):`);
    printRows(skipped);
    return 0;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
