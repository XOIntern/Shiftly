import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { site, siteLocation } from "./site-schema";

// DB-level pins for site / site_location: the partial uniques among live
// rows (site name globally; location name per site) that soft delete
// frees, and the restrict FK a location puts under its site. The plain
// unique on (id, site_id) is not asserted: any duplicate id hits the
// primary key first, so no observation can distinguish the pair
// constraint (it exists for the work_area composite FK to resolve).
// Fixtures are prefixed t-site- and cleaned up after each run.

let fixtureSeq = 0;
const nextSeq = () => `t${++fixtureSeq}`;

const createdSiteIds: string[] = [];
const createdLocationIds: string[] = [];

interface LocationArgs {
  siteId: string;
  name?: string;
}

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-site-${run}-site-${tag}-${siteId}`,
  });
  return siteId;
}

async function createLocation(
  args: LocationArgs,
  id = randomUUID(),
): Promise<string> {
  createdLocationIds.push(id);
  await db.insert(siteLocation).values({
    id,
    siteId: args.siteId,
    name: args.name ?? `t-site-loc-${id}`,
  });
  return id;
}

afterAll(async () => {
  if (createdLocationIds.length > 0) {
    await db.delete(siteLocation).where(
      inArray(siteLocation.id, createdLocationIds),
    );
  }
  if (createdSiteIds.length > 0) {
    await db.delete(site).where(inArray(site.id, createdSiteIds));
  }
});

describe("site", () => {
  test("t-site-anchor: insert with defaults round-trips", async () => {
    const siteId = await createSite(nextSeq(), "a");

    const [row] = await db.select().from(site).where(eq(site.id, siteId));
    expect(row).toBeTruthy();
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  test("duplicate live name: rejected with 23505", async () => {
    const run = nextSeq();
    const name = `t-site-${run}-dup-name`;
    const siteId = randomUUID();
    createdSiteIds.push(siteId);
    await db.insert(site).values({ id: siteId, name });

    const dupeId = randomUUID();
    createdSiteIds.push(dupeId);
    let code: string | undefined;
    try {
      await db.insert(site).values({ id: dupeId, name });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(site).where(eq(site.id, dupeId))).length,
    ).toBe(0);
  });

  test("a soft-deleted site frees its name", async () => {
    const run = nextSeq();
    const name = `t-site-${run}-reusable`;
    const retiredId = randomUUID();
    createdSiteIds.push(retiredId);
    await db.insert(site).values({ id: retiredId, name });
    await db
      .update(site)
      .set({ deletedAt: new Date() })
      .where(eq(site.id, retiredId));

    const reusedId = randomUUID();
    createdSiteIds.push(reusedId);
    await db.insert(site).values({ id: reusedId, name });

    const [row] = await db.select().from(site).where(eq(site.id, reusedId));
    expect(row).toBeTruthy();
    expect(row.deletedAt).toBeNull();
  });
});

describe("site_location", () => {
  test("t-site-anchor: location inserts with its site and round-trips", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "b");
    const locationId = await createLocation({
      siteId,
      name: `t-site-${run}-loc`,
    });

    const [row] = await db
      .select()
      .from(siteLocation)
      .where(eq(siteLocation.id, locationId));
    expect(row).toBeTruthy();
    expect(row.siteId).toBe(siteId);
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("duplicate live name within a site: rejected with 23505", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "dup");
    await createLocation({ siteId, name: `t-site-${run}-same` });

    const dupeId = randomUUID();
    createdLocationIds.push(dupeId);
    let code: string | undefined;
    try {
      await createLocation({ siteId, name: `t-site-${run}-same` }, dupeId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(siteLocation).where(eq(siteLocation.id, dupeId)))
        .length,
    ).toBe(0);
  });

  test("the same location name applies across different sites", async () => {
    const run = nextSeq();
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const sharedName = `t-site-${run}-shared`;
    await createLocation({ siteId: siteAId, name: sharedName });
    const siteBLocationId = await createLocation({
      siteId: siteBId,
      name: sharedName,
    });

    expect(
      (
        await db
          .select()
          .from(siteLocation)
          .where(eq(siteLocation.id, siteBLocationId))
      ).length,
    ).toBe(1);
  });

  test("a soft-deleted location frees its name within the site", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "free");
    const sharedName = `t-site-${run}-reusable`;
    const retiredId = await createLocation({ siteId, name: sharedName });
    await db
      .update(siteLocation)
      .set({ deletedAt: new Date() })
      .where(eq(siteLocation.id, retiredId));

    const reusedId = await createLocation({ siteId, name: sharedName });
    const [row] = await db
      .select()
      .from(siteLocation)
      .where(eq(siteLocation.id, reusedId));
    expect(row).toBeTruthy();
    expect(row.deletedAt).toBeNull();
  });

  test("missing siteId: rejected with 23502", async () => {
    const locationId = randomUUID();
    createdLocationIds.push(locationId);

    let code: string | undefined;
    try {
      await db.insert(siteLocation).values({
        id: locationId,
        siteId: undefined as never,
        name: `t-site-orphan-loc`,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(siteLocation).where(eq(siteLocation.id, locationId)))
        .length,
    ).toBe(0);
  });

  test("unknown siteId: rejected with 23503", async () => {
    const locationId = randomUUID();
    createdLocationIds.push(locationId);

    let code: string | undefined;
    try {
      await createLocation({ siteId: randomUUID() }, locationId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(siteLocation).where(eq(siteLocation.id, locationId)))
        .length,
    ).toBe(0);
  });

  test("deleting the referenced site is restricted while a location binds it: 23001", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "restrict");
    await createLocation({ siteId });

    let code: string | undefined;
    try {
      await db.delete(site).where(eq(site.id, siteId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23001");
    expect(
      (await db.select().from(site).where(eq(site.id, siteId))).length,
    ).toBe(1);
  });
});
