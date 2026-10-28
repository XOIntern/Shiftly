import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { siteLocation } from "@/drizzle/schema";
import type { SessionUser } from "@/types/session";
import { installCleanup } from "@/lib/test-cleanup";
import { seedLocation, seedSite } from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

// Same stubs as bulk.test.ts: the actions resolve their actor through
// requireHO, and there is no Next request context under bun test. The mock
// swaps the WHOLE module across bun's single test process, so every export
// other suites may resolve must exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

async function hoOfNewSite() {
  const s = await seedSite(fixtureCleanup);
  // Locations the actions create are not seeded, so the site's teardown would
  // hit the RESTRICT FK: remove them first (teardowns run newest first).
  fixtureCleanup.defer(async () => {
    await db.delete(siteLocation).where(eq(siteLocation.siteId, s.id));
  });
  const id = randomUUID();
  actor = {
    id,
    name: "T Timezone HO",
    email: `t-tz-${id}@shiftly.test`,
    role: "ho",
    siteId: s.id,
    siteLocationId: null,
    isActive: true,
  };
  return s;
}

async function zoneOfName(siteId: string, name: string) {
  const [row] = await db
    .select({ timezone: siteLocation.timezone })
    .from(siteLocation)
    .where(and(eq(siteLocation.siteId, siteId), eq(siteLocation.name, name)));
  return row?.timezone;
}

describe("location time zone actions", () => {
  test("createLocation stores the chosen time zone", async () => {
    const s = await hoOfNewSite();
    const { createLocation } = await import("./actions");

    const result = await createLocation({
      siteId: s.id,
      name: "Jayapura plant",
      timezone: "Asia/Jayapura",
    });

    expect(result.ok).toBe(true);
    expect(await zoneOfName(s.id, "Jayapura plant")).toBe("Asia/Jayapura");
  });

  test("createLocation without a time zone stores Asia/Jakarta", async () => {
    const s = await hoOfNewSite();
    const { createLocation } = await import("./actions");

    const result = await createLocation({ siteId: s.id, name: "Default plant" });

    expect(result.ok).toBe(true);
    expect(await zoneOfName(s.id, "Default plant")).toBe("Asia/Jakarta");
  });

  test("createLocation refuses a time zone outside the three", async () => {
    const s = await hoOfNewSite();
    const { createLocation } = await import("./actions");

    const result = await createLocation({
      siteId: s.id,
      name: "London plant",
      timezone: "Europe/London" as never,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.timezone).toBeTruthy();
    expect(await zoneOfName(s.id, "London plant")).toBeUndefined();
  });

  test("updateLocation without a time zone keeps the stored zone", async () => {
    const s = await hoOfNewSite();
    const loc = await seedLocation(fixtureCleanup, s.id, {
      timezone: "Asia/Makassar",
    });
    const { updateLocation } = await import("./actions");

    const result = await updateLocation(loc.id, {
      name: "Renamed plant",
      isActive: true,
    });

    expect(result.ok).toBe(true);
    expect(await zoneOfName(s.id, "Renamed plant")).toBe("Asia/Makassar");
  });

  test("updateLocation with a time zone changes it", async () => {
    const s = await hoOfNewSite();
    const loc = await seedLocation(fixtureCleanup, s.id);
    const { updateLocation } = await import("./actions");

    const result = await updateLocation(loc.id, {
      name: "Moved plant",
      isActive: true,
      timezone: "Asia/Makassar",
    });

    expect(result.ok).toBe(true);
    expect(await zoneOfName(s.id, "Moved plant")).toBe("Asia/Makassar");
  });

  test("updateLocation refuses a time zone outside the three and keeps the row", async () => {
    const s = await hoOfNewSite();
    const loc = await seedLocation(fixtureCleanup, s.id, {
      timezone: "Asia/Jayapura",
      name: "Stable plant",
    });
    const { updateLocation } = await import("./actions");

    const result = await updateLocation(loc.id, {
      name: "Stable plant",
      isActive: true,
      timezone: "UTC" as never,
    });

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.timezone).toBeTruthy();
    expect(await zoneOfName(s.id, "Stable plant")).toBe("Asia/Jayapura");
  });
});
