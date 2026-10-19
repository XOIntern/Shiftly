import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { site, siteLocation, workArea } from "../drizzle/schema";

// Pinning test (GitHub #59, carried past the drop-department epic): the
// remaining composite FK on work_area (work_area_site_location_site_fk)
// pins the site_location onto the SAME site as the denormalized site_id.
// A cross-site pairing must be rejected at the DB level with 23503 no
// matter which site the work_area row itself claims — and the
// matching-site insert must succeed. Constraint verified in the dev DB
// catalog (confdeltype 'r'):
//   select conname, confdeltype from pg_constraint
//   where conname like 'work_area%fk';
let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

describe("work_area composite-FK cross-site guard (GitHub #59)", () => {
  test("site_location from site B + site_id = A: rejected with 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const locationId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteAId, name: `${run}-wa-site-a-${siteAId}` },
        { id: siteBId, name: `${run}-wa-site-b-${siteBId}` },
      ]);
      await db.insert(siteLocation).values({
        id: locationId,
        siteId: siteBId,
        name: `${run}-Location B`,
      });

      let code: string | undefined;
      try {
        await db.insert(workArea).values({
          id: workAreaId,
          siteLocationId: locationId, // site B
          siteId: siteAId, // claiming site A — mismatch
          name: `${run}-Cross Site Wa`,
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23503");

      // The rejected insert must have left nothing behind.
      const rows = await db
        .select()
        .from(workArea)
        .where(eq(workArea.id, workAreaId));
      expect(rows).toHaveLength(0);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    }
  });

  test("positive control: matching-site location inserts cleanly and round-trips", async () => {
    const run = `t${nextSeq()}`;
    const siteId = randomUUID();
    const locationId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `${run}-wa-site-${siteId}` });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: `${run}-Location Same`,
      });

      await db.insert(workArea).values({
        id: workAreaId,
        siteLocationId: locationId,
        siteId,
        name: `${run}-Matching Wa`,
      });

      const [row] = await db
        .select()
        .from(workArea)
        .where(eq(workArea.id, workAreaId));
      expect(row).toBeTruthy();
      expect(row.siteLocationId).toBe(locationId);
      expect(row.siteId).toBe(siteId);
      expect(row.name).toBe(`${run}-Matching Wa`);
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).toBeNull();
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
