import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { pgErrorCode } from "./db-errors";
import { department, site, siteLocation, workArea } from "../drizzle/schema";

// Pinning test for GitHub #59: the two composite FKs on work_area
// (work_area_department_site_fk, work_area_site_location_site_fk) pin the
// department and the site_location onto the SAME site. A cross-site pairing
// must be rejected at the DB level with 23503 no matter which site the
// work_area row itself claims — and the matching-site insert must succeed.
// Constraints verified in the dev DB catalog (both confdeltype 'r'):
//   select conname, confdeltype from pg_constraint
//   where conname like 'work_area%fk';
let fixtureSeq = 0;
const nextSeq = () => ++fixtureSeq;

describe("work_area composite-FK cross-site guard (GitHub #59)", () => {
  test("department from site A + site_location from site B, site_id = A: rejected with 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const departmentId = randomUUID();
    const locationId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteAId, name: `${run}-wa-site-a-${siteAId}` },
        { id: siteBId, name: `${run}-wa-site-b-${siteBId}` },
      ]);
      await db.insert(department).values({
        id: departmentId,
        siteId: siteAId,
        name: `${run}-Dept A`,
      });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId: siteBId,
        name: `${run}-Location B`,
      });

      let code: string | undefined;
      try {
        await db.insert(workArea).values({
          id: workAreaId,
          departmentId, // site A
          siteLocationId: locationId, // site B — mismatch
          siteId: siteAId,
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
      await db.delete(department).where(eq(department.id, departmentId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    }
  });

  test("department from site A + site_location from site B, site_id = B: rejected with 23503", async () => {
    const run = `t${nextSeq()}`;
    const siteAId = randomUUID();
    const siteBId = randomUUID();
    const departmentId = randomUUID();
    const locationId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values([
        { id: siteAId, name: `${run}-wa-site-a-${siteAId}` },
        { id: siteBId, name: `${run}-wa-site-b-${siteBId}` },
      ]);
      await db.insert(department).values({
        id: departmentId,
        siteId: siteAId,
        name: `${run}-Dept A`,
      });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId: siteBId,
        name: `${run}-Location B`,
      });

      let code: string | undefined;
      try {
        await db.insert(workArea).values({
          id: workAreaId,
          departmentId, // site A
          siteLocationId: locationId, // site B — mismatch
          siteId: siteBId, // claiming the location's site still fails: the department no longer matches
          name: `${run}-Cross Site Wa`,
        });
      } catch (err) {
        code = pgErrorCode(err);
      }
      expect(code).toBe("23503");

      const rows = await db
        .select()
        .from(workArea)
        .where(eq(workArea.id, workAreaId));
      expect(rows).toHaveLength(0);
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(department).where(eq(department.id, departmentId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteAId));
      await db.delete(site).where(eq(site.id, siteBId));
    }
  });

  test("positive control: matching-site parents insert cleanly and round-trip", async () => {
    const run = `t${nextSeq()}`;
    const siteId = randomUUID();
    const departmentId = randomUUID();
    const locationId = randomUUID();
    const workAreaId = randomUUID();

    try {
      await db.insert(site).values({ id: siteId, name: `${run}-wa-site-${siteId}` });
      await db.insert(department).values({
        id: departmentId,
        siteId,
        name: `${run}-Dept Same`,
      });
      await db.insert(siteLocation).values({
        id: locationId,
        siteId,
        name: `${run}-Location Same`,
      });

      await db.insert(workArea).values({
        id: workAreaId,
        departmentId,
        siteLocationId: locationId,
        siteId,
        name: `${run}-Matching Wa`,
      });

      const [row] = await db
        .select()
        .from(workArea)
        .where(eq(workArea.id, workAreaId));
      expect(row).toBeTruthy();
      expect(row.departmentId).toBe(departmentId);
      expect(row.siteLocationId).toBe(locationId);
      expect(row.siteId).toBe(siteId);
      expect(row.name).toBe(`${run}-Matching Wa`);
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).toBeNull();
    } finally {
      await db.delete(workArea).where(eq(workArea.id, workAreaId));
      await db.delete(department).where(eq(department.id, departmentId));
      await db.delete(siteLocation).where(eq(siteLocation.id, locationId));
      await db.delete(site).where(eq(site.id, siteId));
    }
  });
});
