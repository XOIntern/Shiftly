import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { installCleanup } from "../test-cleanup";
import {
  seedAuditLog,
  seedLocation,
  seedSite,
  seedUser,
} from "../test-fixtures";
import { auditActionLabel, loadAuditFeed } from "./audit-feed";

const cleanup = installCleanup();

const BASE = Date.parse("2026-01-07T08:00:00Z");
const at = (minutes: number) => new Date(BASE + minutes * 60_000);

describe("auditActionLabel", () => {
  test("a known action is a readable label, not the raw string", () => {
    const label = auditActionLabel("roster.publish");
    expect(label).not.toBe("roster.publish");
    expect(label.length).toBeGreaterThan(0);
  });

  test("an unknown action returns itself", () => {
    expect(auditActionLabel("something.unknown")).toBe("something.unknown");
  });
});

describe("loadAuditFeed", () => {
  test("is newest first and capped at 10 with 12 rows seeded", async () => {
    const s = await seedSite(cleanup);
    const ho = await seedUser(cleanup, { role: "ho", siteId: s.id });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const row = await seedAuditLog(cleanup, {
        actorId: ho.id,
        siteId: s.id,
        createdAt: at(i),
      });
      ids.push(row.id);
    }

    const feed = await loadAuditFeed(ho);

    expect(feed).toHaveLength(10);
    expect(feed.map((e) => e.id)).toEqual(ids.slice(2).reverse());
    expect(feed[0].createdAt).toBe(at(11).toISOString());
  });

  test("honours an explicit limit", async () => {
    const s = await seedSite(cleanup);
    const ho = await seedUser(cleanup, { role: "ho", siteId: s.id });
    for (let i = 0; i < 4; i++) {
      await seedAuditLog(cleanup, {
        actorId: ho.id,
        siteId: s.id,
        createdAt: at(i),
      });
    }

    expect(await loadAuditFeed(ho, 3)).toHaveLength(3);
  });

  test("an ho sees only their own site's rows, never a row without a site", async () => {
    const own = await seedSite(cleanup);
    const other = await seedSite(cleanup);
    const ho = await seedUser(cleanup, { role: "ho", siteId: own.id });
    const actor = await seedUser(cleanup, { role: "superadmin" });
    const mine = await seedAuditLog(cleanup, {
      actorId: actor.id,
      siteId: own.id,
    });
    await seedAuditLog(cleanup, { actorId: actor.id, siteId: other.id });
    await seedAuditLog(cleanup, { actorId: actor.id });

    const feed = await loadAuditFeed(ho);

    expect(feed.map((e) => e.id)).toEqual([mine.id]);
  });

  test("a superadmin sees the rows of every site and of no site", async () => {
    const a = await seedSite(cleanup);
    const b = await seedSite(cleanup);
    const sa = await seedUser(cleanup, { role: "superadmin" });
    const rowA = await seedAuditLog(cleanup, { actorId: sa.id, siteId: a.id });
    const rowB = await seedAuditLog(cleanup, { actorId: sa.id, siteId: b.id });
    const rowNone = await seedAuditLog(cleanup, { actorId: sa.id });

    const ids = (await loadAuditFeed(sa, 1000)).map((e) => e.id);

    expect(ids).toContain(rowA.id);
    expect(ids).toContain(rowB.id);
    expect(ids).toContain(rowNone.id);
  });

  test("an admin and an unbound ho get nothing", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    const admin = await seedUser(cleanup, {
      role: "admin",
      siteId: s.id,
      siteLocationId: loc.id,
    });
    const unboundHo = await seedUser(cleanup, { role: "ho" });
    await seedAuditLog(cleanup, {
      actorId: admin.id,
      siteId: s.id,
      siteLocationId: loc.id,
    });

    expect(await loadAuditFeed(admin)).toEqual([]);
    expect(await loadAuditFeed(unboundHo)).toEqual([]);
  });

  test("entries carry the actor and location names, a null location when the row has none, and no details", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id);
    const ho = await seedUser(cleanup, { role: "ho", siteId: s.id });
    const withLoc = await seedAuditLog(cleanup, {
      actorId: ho.id,
      siteId: s.id,
      siteLocationId: loc.id,
      action: "roster.publish",
      createdAt: at(1),
    });
    const withoutLoc = await seedAuditLog(cleanup, {
      actorId: ho.id,
      siteId: s.id,
      createdAt: at(0),
    });

    const feed = await loadAuditFeed(ho);

    expect(feed).toHaveLength(2);
    const [first, second] = feed;
    expect(first).toEqual({
      id: withLoc.id,
      action: "roster.publish",
      label: auditActionLabel("roster.publish"),
      actorName: ho.name,
      locationName: loc.name,
      createdAt: at(1).toISOString(),
    });
    expect(second.id).toBe(withoutLoc.id);
    expect(second.locationName).toBeNull();
    expect(second.label).toBe("test.fixture");
    for (const entry of feed) expect("details" in entry).toBe(false);
  });
});
