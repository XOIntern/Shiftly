import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "./db";
import { restoreSiteGuarded } from "./site-restore";
import { site } from "../drizzle/schema";
import { installCleanup } from "@/lib/test-cleanup";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

async function seedSite(opts: {
  name?: string;
  deleted: boolean;
  isActive?: boolean;
}): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const name = opts.name ?? `t185-restore-${id}`;
  fixtureCleanup.defer(async () => {
    await db.delete(site).where(eq(site.id, id));
  });
  await db.insert(site).values({
    id,
    name,
    isActive: opts.isActive ?? false,
    deletedAt: opts.deleted ? new Date() : null,
  });
  return { id, name };
}

async function rowOf(id: string) {
  const [row] = await db
    .select({ deletedAt: site.deletedAt, isActive: site.isActive })
    .from(site)
    .where(eq(site.id, id));
  return row;
}

function restore(id: string) {
  return db.transaction((tx) => restoreSiteGuarded(tx, id));
}

describe("restoreSiteGuarded", () => {
  test("a soft-deleted site comes back live and stays inactive", async () => {
    const { id } = await seedSite({ deleted: true });

    expect(await restore(id)).toEqual({ ok: true });

    expect(await rowOf(id)).toEqual({ deletedAt: null, isActive: false });
  });

  test("a site that is not soft-deleted is refused and left alone", async () => {
    const { id } = await seedSite({ deleted: false, isActive: true });

    expect(await restore(id)).toEqual({
      ok: false,
      message: "Deleted site not found.",
    });
    expect(await rowOf(id)).toEqual({ deletedAt: null, isActive: true });
  });

  test("an unknown id is refused", async () => {
    expect(await restore(randomUUID())).toEqual({
      ok: false,
      message: "Deleted site not found.",
    });
  });

  test("a live site already using the name refuses the restore", async () => {
    const name = `t185-restore-dup-${randomUUID()}`;
    const { id } = await seedSite({ name, deleted: true });
    await seedSite({ name, deleted: false });

    expect(await restore(id)).toEqual({
      ok: false,
      message: "A site with this name already exists",
    });
    expect((await rowOf(id)).deletedAt).not.toBeNull();
  });

  test("another deleted site with the same name does not block the restore", async () => {
    const name = `t185-restore-twin-${randomUUID()}`;
    const { id } = await seedSite({ name, deleted: true });
    const twin = await seedSite({ name, deleted: true });

    expect(await restore(id)).toEqual({ ok: true });
    expect((await rowOf(twin.id)).deletedAt).not.toBeNull();
  });
});
