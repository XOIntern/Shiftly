import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { site, siteLocation, user } from "../drizzle/schema";

// Task 1 of the soft-delete epic (GitHub #37): site, site_location and user
// gain a nullable deleted_at and their unique constraints become partial
// unique indexes (WHERE deleted_at IS NULL). These tests run against the real
// dev DB (docker shiftly-postgres :5433) and pin the actual constraint
// behaviour: a soft-deleted row frees its name/email for reuse, while a live
// duplicate is still refused with 23505.
describe("soft delete partial unique indexes (issue #37 task 1)", () => {
  test("site: soft-deleted name is reusable; live duplicate still refused (23505)", async () => {
    const originalId = randomUUID();
    const replacementId = randomUUID();
    const name = `soft-del-site-${randomUUID()}`;

    try {
      await db.insert(site).values({ id: originalId, name });

      // Live duplicate is still refused by the partial index.
      let code: string | undefined;
      try {
        await db.insert(site).values({ id: replacementId, name });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");

      // Soft-delete the original: its name leaves the index.
      await db
        .update(site)
        .set({ deletedAt: sql`now()` })
        .where(eq(site.id, originalId));

      // The name can now be reused by a new live row.
      const reused = await db
        .insert(site)
        .values({ id: replacementId, name })
        .returning({ id: site.id });
      expect(reused).toEqual([{ id: replacementId }]);

      // ...but two live rows with the same name remain impossible.
      const thirdId = randomUUID();
      code = undefined;
      try {
        await db.insert(site).values({ id: thirdId, name });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");
    } finally {
      await db.delete(site).where(eq(site.id, replacementId));
      await db.delete(site).where(eq(site.id, originalId));
    }
  });

  test("site_location: soft-deleted (site_id, name) pair is reusable; live duplicate still refused (23505)", async () => {
    const siteId = randomUUID();
    const originalId = randomUUID();
    const replacementId = randomUUID();
    const name = `soft-del-loc-${randomUUID()}`;

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-loc-site-${siteId}` });
      await db.insert(siteLocation).values({
        id: originalId,
        siteId,
        name,
      });

      // Live duplicate of the (site_id, name) pair is refused.
      let code: string | undefined;
      try {
        await db.insert(siteLocation).values({
          id: replacementId,
          siteId,
          name,
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");

      // Soft-delete the original: the pair frees up.
      await db
        .update(siteLocation)
        .set({ deletedAt: sql`now()` })
        .where(eq(siteLocation.id, originalId));

      const reused = await db
        .insert(siteLocation)
        .values({ id: replacementId, siteId, name })
        .returning({ id: siteLocation.id });
      expect(reused).toEqual([{ id: replacementId }]);

      // A third live row with the same pair is still refused.
      const thirdId = randomUUID();
      code = undefined;
      try {
        await db.insert(siteLocation).values({ id: thirdId, siteId, name });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");
    } finally {
      await db.delete(siteLocation).where(eq(siteLocation.id, replacementId));
      await db.delete(siteLocation).where(eq(siteLocation.id, originalId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });

  test("user: soft-deleted email is reusable; live duplicate still refused (23505)", async () => {
    const originalId = randomUUID();
    const replacementId = randomUUID();
    const email = `soft-del-${randomUUID()}@shiftly.test`;

    try {
      await db.insert(user).values({
        id: originalId,
        name: "Soft Delete Original",
        email,
        emailVerified: true,
        role: "ho",
      });

      // Live duplicate email is refused.
      let code: string | undefined;
      try {
        await db.insert(user).values({
          id: replacementId,
          name: "Soft Delete Duplicate",
          email,
          emailVerified: true,
          role: "ho",
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");

      // Soft-delete the original: the email frees up.
      await db
        .update(user)
        .set({ deletedAt: sql`now()` })
        .where(eq(user.id, originalId));

      const reused = await db
        .insert(user)
        .values({
          id: replacementId,
          name: "Soft Delete Replacement",
          email,
          emailVerified: true,
          role: "ho",
        })
        .returning({ id: user.id });
      expect(reused).toEqual([{ id: replacementId }]);

      // A third live row with the same email is still refused.
      const thirdId = randomUUID();
      code = undefined;
      try {
        await db.insert(user).values({
          id: thirdId,
          name: "Soft Delete Third",
          email,
          emailVerified: true,
          role: "ho",
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23505");
    } finally {
      await db.delete(user).where(eq(user.id, replacementId));
      await db.delete(user).where(eq(user.id, originalId));
    }
  });

  test("deletedAt is nullable and null by default on all three tables", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `soft-del-null-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: "Null DeletedAt Location",
      });
      await db.insert(user).values({
        id: userId,
        name: "Null DeletedAt User",
        email: `soft-del-null-${userId}@shiftly.test`,
        emailVerified: true,
        role: "ho",
        siteId,
      });

      const [siteRow] = await db.select().from(site).where(eq(site.id, siteId));
      expect(siteRow.deletedAt).toBeNull();
      const [locRow] = await db
        .select()
        .from(siteLocation)
        .where(eq(siteLocation.id, locationId));
      expect(locRow.deletedAt).toBeNull();
      const [userRow] = await db.select().from(user).where(eq(user.id, userId));
      expect(userRow.deletedAt).toBeNull();

      // The live-scope predicate later tasks will rely on.
      const liveSites = await db
        .select({ id: site.id })
        .from(site)
        .where(and(eq(site.id, siteId), isNull(site.deletedAt)));
      expect(liveSites).toEqual([{ id: siteId }]);
    } finally {
      await db.delete(user).where(eq(user.id, userId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
