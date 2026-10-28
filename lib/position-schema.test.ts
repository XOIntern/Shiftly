import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "../error/db-errors";
import { position, site } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// position (per-site catalog): a position belongs to exactly one site —
// ON DELETE RESTRICT, so a site that still has a position cannot be
// hard-deleted (23001 restrict_violation; see location-fk.test.ts for why
// 23503 is accepted as the generic FK fallback). Names are unique per site
// among LIVE rows only: the partial unique index ignores soft-deleted rows,
// so a soft-deleted position frees its name for reuse, while the same name
// under a different site is always allowed. Mirrors the pinning style of
// work-area-fk.test.ts and soft-delete-schema.test.ts against the real dev
// DB (docker shiftly-postgres :5433).
describe("position schema guards", () => {
  test("positive control: a position round-trips with its site and defaults", async () => {
    const siteId = randomUUID();
    const positionId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: `pos-site-${siteId}` });
    await db.insert(position).values({
      id: positionId,
      siteId,
      name: `pos-roundtrip-${positionId}`,
    });

    const [row] = await db
      .select()
      .from(position)
      .where(eq(position.id, positionId));
    expect(row).toBeTruthy();
    expect(row.siteId).toBe(siteId);
    expect(row.name).toBe(`pos-roundtrip-${positionId}`);
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
  });

  test("deleting a site that still has a position violates the FK (23001/23503)", async () => {
    const siteId = randomUUID();
    const positionId = randomUUID();

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db.insert(site).values({ id: siteId, name: `pos-fk-${siteId}` });
    await db.insert(position).values({
      id: positionId,
      siteId,
      name: `pos-fk-${positionId}`,
    });

    let code: string | undefined;
    try {
      await db.delete(site).where(eq(site.id, siteId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code === "23001" || code === "23503").toBe(true);

    // The refused delete must have left both rows in place.
    const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
    expect(siteRow).toBeTruthy();
    const [posRow] = await db
      .select()
      .from(position)
      .where(eq(position.id, positionId));
    expect(posRow).toBeTruthy();
  });

  test("(site_id, name): live duplicate refused (23505); soft-deleted name is reusable", async () => {
    const siteId = randomUUID();
    const originalId = randomUUID();
    const replacementId = randomUUID();
    const name = `pos-uniq-${randomUUID()}`;

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, replacementId));
      await db.delete(position).where(eq(position.id, originalId));
      await db.delete(site).where(eq(site.id, siteId));
    });
    await db
      .insert(site)
      .values({ id: siteId, name: `pos-uniq-site-${siteId}` });
    await db.insert(position).values({ id: originalId, siteId, name });

    // A live duplicate of the (site_id, name) pair is refused.
    let code: string | undefined;
    try {
      await db.insert(position).values({ id: replacementId, siteId, name });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");

    // Soft-delete the original: its name leaves the index.
    await db
      .update(position)
      .set({ deletedAt: sql`now()` })
      .where(eq(position.id, originalId));

    const reused = await db
      .insert(position)
      .values({ id: replacementId, siteId, name })
      .returning({ id: position.id });
    expect(reused).toEqual([{ id: replacementId }]);

    // ...but two live rows with the same pair remain impossible.
    const thirdId = randomUUID();
    code = undefined;
    try {
      await db.insert(position).values({ id: thirdId, siteId, name });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
  });

  test("same position name under different sites is allowed", async () => {
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const positionAId = randomUUID();
    const positionBId = randomUUID();
    const name = `pos-cross-${randomUUID()}`;

    fixtureCleanup.defer(async () => {
      await db.delete(position).where(eq(position.id, positionAId));
      await db.delete(position).where(eq(position.id, positionBId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    });
    await db.insert(site).values([
      { id: siteAId, name: `pos-cross-site-a-${siteAId}` },
      { id: siteBId, name: `pos-cross-site-b-${siteBId}` },
    ]);
    await db.insert(position).values([
      { id: positionAId, siteId: siteAId, name },
      { id: positionBId, siteId: siteBId, name },
    ]);

    const rows = await db
      .select({ id: position.id })
      .from(position)
      .where(eq(position.name, name));
    expect(rows).toHaveLength(2);
  });
});
