import "dotenv/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inArray, like, or } from "drizzle-orm";

import { db } from "../lib/db";
import { auditLog, site, siteLocation, user } from "../drizzle/schema";

// Removes fixture rows that db-backed test suites left behind before their
// cleanup was made failure-proof. Dry run by default: it prints the target
// database and what it would delete. Only `--yes` deletes, in one
// transaction, in foreign-key order; anything else still referencing a
// matched row makes the transaction fail and roll back.
//
// Matching is exact: a known test prefix AND a random uuid suffix (never an
// e-mail domain), so hand-made rows that merely look similar are left alone.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const FIXTURE_PATTERNS = {
  // locations/bulk.test.ts: the foreign site of the deleteBulk test.
  siteName: [new RegExp(`^t4-loc-fs-${UUID}$`)],
  // lib/auth-rbac-guard.test.ts and requests/actions.test.ts actors.
  userEmail: [
    new RegExp(`^auth-guard-${UUID}@shiftly\\.test$`),
    new RegExp(`^t-mp-act-${UUID}@shiftly\\.test$`),
  ],
} as const;

// SQL LIKE prefilters; the regexes above make the final call.
const SITE_PREFIXES = ["t4-loc-fs-%"];
const USER_EMAIL_PREFIXES = ["auth-guard-%", "t-mp-act-%"];

export function isFixtureSiteName(name: string): boolean {
  return FIXTURE_PATTERNS.siteName.some((pattern) => pattern.test(name));
}

export function isFixtureUserEmail(email: string): boolean {
  return FIXTURE_PATTERNS.userEmail.some((pattern) => pattern.test(email));
}

export function databaseName(url: string | undefined): string {
  if (!url) return "(DATABASE_URL not set)";
  try {
    return new URL(url).pathname.replace(/^\//, "") || "(none)";
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function findFixtures() {
  const sites = (
    await db
      .select({ id: site.id, name: site.name })
      .from(site)
      .where(or(...SITE_PREFIXES.map((prefix) => like(site.name, prefix))))
  ).filter((row) => isFixtureSiteName(row.name));
  const users = (
    await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(
        or(...USER_EMAIL_PREFIXES.map((prefix) => like(user.email, prefix))),
      )
  ).filter((row) => isFixtureUserEmail(row.email));

  const siteIds = sites.map((row) => row.id);
  const userIds = users.map((row) => row.id);
  const locations =
    siteIds.length > 0
      ? await db
          .select({ id: siteLocation.id })
          .from(siteLocation)
          .where(inArray(siteLocation.siteId, siteIds))
      : [];
  const audits =
    userIds.length > 0
      ? await db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(inArray(auditLog.actorId, userIds))
      : [];
  return {
    siteIds,
    userIds,
    locationIds: locations.map((row) => row.id),
    auditIds: audits.map((row) => row.id),
  };
}

async function main() {
  const apply = process.argv.includes("--yes");
  console.log(`Target database: ${databaseName(process.env.DATABASE_URL)}`);

  const found = await findFixtures();
  console.log(`audit_log rows by fixture users: ${found.auditIds.length}`);
  console.log(`user (fixture e-mails, account/session cascade): ${found.userIds.length}`);
  console.log(`site_location under fixture sites: ${found.locationIds.length}`);
  console.log(`site (fixture names): ${found.siteIds.length}`);

  if (!apply) {
    console.log("Dry run: nothing deleted. Re-run with --yes to delete.");
    return;
  }

  await db.transaction(async (tx) => {
    if (found.auditIds.length > 0) {
      await tx.delete(auditLog).where(inArray(auditLog.id, found.auditIds));
    }
    if (found.userIds.length > 0) {
      await tx.delete(user).where(inArray(user.id, found.userIds));
    }
    if (found.locationIds.length > 0) {
      await tx
        .delete(siteLocation)
        .where(inArray(siteLocation.id, found.locationIds));
    }
    if (found.siteIds.length > 0) {
      await tx.delete(site).where(inArray(site.id, found.siteIds));
    }
  });
  console.log("Deleted.");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    console.error(
      "Rolled back, nothing deleted:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await db.$client.end();
  }
}
