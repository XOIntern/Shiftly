import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db } from "../../lib/db";
import { pgErrorCode } from "../../error/db-errors";
import { position } from "./position-schema";
import { site } from "./site-schema";

// DB-level pins for position (per-site jabatan catalog): the partial
// unique on (site_id, name) among live rows — same name allowed across
// sites and reusable after a soft delete — the restrict FK to site that
// survives even soft-deleted positions, and the required site binding.
// The plain unique on (id, site_id) is not asserted: any duplicate id hits
// the primary key first, so no observation can distinguish the pair
// constraint (it exists for the worker composite FK to resolve). Fixtures
// are prefixed t-position- and cleaned up after each run.

let fixtureSeq = 0;
const nextSeq = () => `t${++fixtureSeq}`;

const createdSiteIds: string[] = [];
const createdPositionIds: string[] = [];

async function createSite(run: string, tag: string): Promise<string> {
  const siteId = randomUUID();
  createdSiteIds.push(siteId);
  await db.insert(site).values({
    id: siteId,
    name: `t-position-${run}-site-${tag}-${siteId}`,
  });
  return siteId;
}

interface PositionArgs {
  siteId: string;
  name?: string;
}

// Insert a tracked position; the id is pre-generated so callers of
// EXPECTED-violation inserts can assert no row was left behind.
async function insertPosition(
  args: PositionArgs,
  id = randomUUID(),
): Promise<string> {
  createdPositionIds.push(id);
  await db.insert(position).values({
    id,
    siteId: args.siteId,
    name: args.name ?? `t-position-name-${id}`,
  });
  return id;
}

afterAll(async () => {
  if (createdPositionIds.length > 0) {
    await db.delete(position).where(inArray(position.id, createdPositionIds));
  }
  if (createdSiteIds.length > 0) {
    await db.delete(site).where(inArray(site.id, createdSiteIds));
  }
});

describe("position (per-site jabatan catalog)", () => {
  test("t-position-anchor: insert with defaults round-trips", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "a");
    const positionId = await insertPosition({ siteId, name: "Shift Leader" });

    const [row] = await db
      .select()
      .from(position)
      .where(eq(position.id, positionId));
    expect(row).toBeTruthy();
    expect(row.siteId).toBe(siteId);
    expect(row.name).toBe("Shift Leader");
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  test("id comes from the column default", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "b");
    const [row] = await db
      .insert(position)
      .values({ siteId, name: `t-position-${run}-defaulted` })
      .returning({ id: position.id });
    createdPositionIds.push(row.id);

    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("missing siteId: rejected with 23502", async () => {
    const positionId = randomUUID();
    createdPositionIds.push(positionId);

    let code: string | undefined;
    try {
      await db.insert(position).values({
        id: positionId,
        siteId: undefined as never,
        name: `t-position-orphan`,
      });
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23502");
    expect(
      (await db.select().from(position).where(eq(position.id, positionId)))
        .length,
    ).toBe(0);
  });

  test("unknown siteId: rejected with 23503", async () => {
    const positionId = randomUUID();
    createdPositionIds.push(positionId);

    let code: string | undefined;
    try {
      await insertPosition({ siteId: randomUUID() }, positionId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23503");
    expect(
      (await db.select().from(position).where(eq(position.id, positionId)))
        .length,
    ).toBe(0);
  });

  test("duplicate live name within a site: rejected with 23505", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "dup");
    await insertPosition({ siteId, name: "Operator" });

    const dupeId = randomUUID();
    createdPositionIds.push(dupeId);
    let code: string | undefined;
    try {
      await insertPosition({ siteId, name: "Operator" }, dupeId);
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23505");
    expect(
      (await db.select().from(position).where(eq(position.id, dupeId)))
        .length,
    ).toBe(0);
  });

  test("the same name applies across different sites", async () => {
    const run = nextSeq();
    const siteAId = await createSite(run, "a");
    const siteBId = await createSite(run, "b");
    const siteAPositionId = await insertPosition({
      siteId: siteAId,
      name: "Operator",
    });
    const siteBPositionId = await insertPosition({
      siteId: siteBId,
      name: "Operator",
    });

    expect(
      (
        await db
          .select()
          .from(position)
          .where(inArray(position.id, [siteAPositionId, siteBPositionId]))
      ).length,
    ).toBe(2);
  });

  test("a soft-deleted position frees its name within the site", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "free");
    const retiredId = await insertPosition({ siteId, name: "Supervisor" });
    await db
      .update(position)
      .set({ deletedAt: new Date() })
      .where(eq(position.id, retiredId));

    const reusedId = await insertPosition({ siteId, name: "Supervisor" });
    const [row] = await db
      .select()
      .from(position)
      .where(eq(position.id, reusedId));
    expect(row).toBeTruthy();
    expect(row.deletedAt).toBeNull();
  });

  test("deleting the referenced site is restricted: 23001", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "restrict");
    await insertPosition({ siteId, name: "Shift Leader" });

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

  test("site deletion stays restricted even when every position is soft-deleted", async () => {
    const run = nextSeq();
    const siteId = await createSite(run, "soft");
    const positionId = await insertPosition({ siteId, name: "Shift Leader" });
    await db
      .update(position)
      .set({ deletedAt: new Date() })
      .where(eq(position.id, positionId));

    let code: string | undefined;
    try {
      await db.delete(site).where(eq(site.id, siteId));
    } catch (err) {
      code = pgErrorCode(err);
    }
    expect(code).toBe("23001");

    // Leave the DB as the afterAll helper expects: the position must be
    // gone for the plain site delete to succeed during cleanup.
    await db.delete(position).where(eq(position.id, positionId));
    expect(
      (await db.select().from(position).where(eq(position.id, positionId)))
        .length,
    ).toBe(0);
  });
});
