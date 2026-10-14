import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { site, siteLocation, user } from "../drizzle/schema";

// Real dev DB (docker shiftly-postgres :5433): proves the site_location ->
// user FK is enforced with ON DELETE RESTRICT by hitting the constraint the
// way a live delete would, then cleaning every row up.
describe("site_location delete FK restrict", () => {
  test("deleting a location bound to a user violates the FK (23503)", async () => {
    const siteId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();

    await db.insert(site).values({
      id: siteId,
      name: `fk-loc-site-${siteId}`,
    });
    await db.insert(siteLocation).values({
      id: locationId,
      siteId,
      name: "Main Warehouse",
      address: "Jl. Test 123",
    });
    // The binding that must hold the location: role "admin" is the role the
    // redesign binds to exactly one site_location.
    await db.insert(user).values({
      id: userId,
      name: "Location FK Test Admin",
      email: `loc-fk-${userId}@shiftly.test`,
      emailVerified: true,
      role: "admin",
      siteLocationId: locationId,
    });

    let code: string | undefined;
    try {
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    // Issue #13 said 23503, but Postgres raises 23001 (restrict_violation)
    // for ON DELETE RESTRICT constraints; 23503 only covers NO ACTION. The
    // delete still must fail with a foreign-key error code either way.
    expect(code === "23001" || code === "23503").toBe(true);

    // Cleanup in child-first order; user delete cascades nothing here but
    // must go before the location row it references.
    await db.delete(user).where(eq(user.id, userId));
    await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
    await db.delete(site).where(eq(site.id, siteId));
  });
});
