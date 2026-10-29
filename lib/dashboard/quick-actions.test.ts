import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { installCleanup } from "../test-cleanup";
import { seedLocation, seedSite } from "../test-fixtures";
import { loadQuickLinks, quickLinksFor } from "./quick-actions";

const cleanup = installCleanup();

// 2026-01-07 23:30 in Jakarta, already 2026-01-08 01:30 in Jayapura.
const NOW = new Date("2026-01-07T16:30:00Z");

describe("quickLinksFor", () => {
  test("gives the three links in order with the location's id, week and today", () => {
    expect(
      quickLinksFor(
        { id: "loc-1" },
        { week: "2026-01-05", today: "2026-01-07" },
      ),
    ).toEqual([
      { label: "Create request", href: "/dashboard/requests/new" },
      {
        label: "Open this week's roster",
        href: "/dashboard/roster?week=2026-01-05&locationId=loc-1",
      },
      {
        label: "Record today's attendance",
        href: "/dashboard/attendance?location=loc-1&date=2026-01-07",
      },
    ]);
  });
});

describe("loadQuickLinks", () => {
  test("an admin on a Jayapura location gets that location's local today", async () => {
    const s = await seedSite(cleanup);
    const loc = await seedLocation(cleanup, s.id, {
      timezone: "Asia/Jayapura",
    });

    const links = await loadQuickLinks(
      { role: "admin", siteId: s.id, siteLocationId: loc.id },
      NOW,
    );

    expect(links.map((l) => l.href)).toEqual([
      "/dashboard/requests/new",
      `/dashboard/roster?week=2026-01-05&locationId=${loc.id}`,
      `/dashboard/attendance?location=${loc.id}&date=2026-01-08`,
    ]);
  });

  test("an unbound admin gets nothing", async () => {
    const s = await seedSite(cleanup);
    await seedLocation(cleanup, s.id);

    expect(
      await loadQuickLinks(
        { role: "admin", siteId: s.id, siteLocationId: null },
        NOW,
      ),
    ).toEqual([]);
  });
});
