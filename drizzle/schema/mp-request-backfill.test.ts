import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../lib/db";
import { installCleanup } from "../../lib/test-cleanup";
import {
  seedLocation,
  seedMpRequest,
  seedSite,
  seedUser,
} from "../../lib/test-fixtures";
import { mpRequest } from "./mp-request-schema";

// Runs the weekly_request_open_to_approved migration's SQL against the shared
// development database. Besides the rows seeded here it also converts any
// pre-existing weekly `open` row in that database, which is the migration's
// intended effect. Seeded rows sit in distinct weeks of one location so the
// partial unique index never conflicts.

const cleanup = installCleanup();

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");

function backfillSql(): string {
  const file = readdirSync(MIGRATIONS_DIR).find((name) =>
    name.endsWith("weekly_request_open_to_approved.sql"),
  );
  if (!file) throw new Error("backfill migration file not found");
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

describe("weekly request backfill migration", () => {
  test("turns weekly open rows into approved and leaves every other row alone", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: s.id,
      siteLocationId: loc.id,
    });
    const createdBy = admin.id;

    const weeklyOpen = await seedMpRequest(cleanup, loc, {
      createdBy,
      status: "open",
      weekStart: "2026-02-02",
    });
    const dailyOpen = await seedMpRequest(cleanup, loc, {
      createdBy,
      status: "open",
      type: "daily",
      requestDate: "2026-02-10",
    });
    const weeklyRejected = await seedMpRequest(cleanup, loc, {
      createdBy,
      status: "rejected",
      weekStart: "2026-02-09",
    });
    const weeklyWithdrawn = await seedMpRequest(cleanup, loc, {
      createdBy,
      status: "withdrawn",
      weekStart: "2026-02-16",
    });
    const weeklyFulfilled = await seedMpRequest(cleanup, loc, {
      createdBy,
      status: "fulfilled",
      weekStart: "2026-02-23",
    });

    await db.execute(sql.raw(backfillSql()));

    const ids = [
      weeklyOpen.id,
      dailyOpen.id,
      weeklyRejected.id,
      weeklyWithdrawn.id,
      weeklyFulfilled.id,
    ];
    const rows = await db
      .select({ id: mpRequest.id, status: mpRequest.status })
      .from(mpRequest)
      .where(inArray(mpRequest.id, ids));
    const statusOf = new Map(rows.map((r) => [r.id, r.status]));

    expect(statusOf.get(weeklyOpen.id)).toBe("approved");
    expect(statusOf.get(dailyOpen.id)).toBe("open");
    expect(statusOf.get(weeklyRejected.id)).toBe("rejected");
    expect(statusOf.get(weeklyWithdrawn.id)).toBe("withdrawn");
    expect(statusOf.get(weeklyFulfilled.id)).toBe("fulfilled");

    const stillOpenWeeklyHere = await db
      .select({ id: mpRequest.id })
      .from(mpRequest)
      .where(
        and(
          eq(mpRequest.siteLocationId, loc.id),
          sql`${mpRequest.type} = 'weekly' and ${mpRequest.status} = 'open'`,
        ),
      );
    expect(stillOpenWeeklyHere).toHaveLength(0);
  });
});
