import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { SessionUser } from "@/types/session";
import type { LocationTimezone } from "@/types/timezone";
import { installCleanup } from "@/lib/test-cleanup";
import {
  seedLocation,
  seedShift,
  seedSite,
  seedWorkArea,
} from "@/lib/test-fixtures";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const cleanup = installCleanup();
afterEach(() => setSystemTime());

// The page reads its actor through requireUser (all three roles open it; the
// write surface differs) — swapped for a stub so the real server component
// renders against the test database. The mock swaps the WHOLE module across
// bun's single test process, so every export other suites may resolve must
// exist here.
let actor: SessionUser;
mock.module("@/lib/session", () => ({
  getUser: async () => actor,
  requireUser: async () => actor,
  requireHO: async () => actor,
  requireSuperadmin: async () => actor,
}));

// The tree the page hands back renders a client component that reads
// navigation hooks; no Next request context exists under bun test.
const realNavigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...realNavigation,
  redirect: () => {
    throw new Error("redirect");
  },
  // Every stub in the repo carries notFound because bun's module mocks are
  // process-wide and the last registration wins across suites.
  notFound: () => {
    throw new Error("not-found");
  },
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/attendance",
  useSearchParams: () => new URLSearchParams(),
}));
const realNextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...realNextCache,
  revalidatePath: () => {},
}));

type ViewProps = {
  date: string;
  canWrite: boolean;
  future: boolean;
  locationOptions: { id: string; label: string }[];
  locationId: string;
  data: { timezone: string; shifts: { id: string }[]; areas: { id: string }[] };
  shiftId: string | null;
  areaId: string | null;
};

type Search = Record<string, string | string[] | undefined>;

// The page returns the view element: its props are the page's whole output.
async function pageProps(searchParams: Search = {}): Promise<ViewProps> {
  const { default: AttendancePage } = await import("./page");
  const tree = (await AttendancePage({
    searchParams: Promise.resolve(searchParams),
  } as never)) as { props: ViewProps };
  return tree.props;
}

async function pageHtml(searchParams: Search = {}): Promise<string> {
  const { default: AttendancePage } = await import("./page");
  return renderToStaticMarkup(
    (await AttendancePage({
      searchParams: Promise.resolve(searchParams),
    } as never)) as never,
  );
}

function sessionOf(
  role: SessionUser["role"],
  binding: { siteId?: string | null; siteLocationId?: string | null } = {},
): SessionUser {
  const id = randomUUID();
  return {
    id,
    name: `T Attendance ${role}`,
    email: `t-att-page-${id}@shiftly.test`,
    role,
    siteId: binding.siteId ?? null,
    siteLocationId: binding.siteLocationId ?? null,
    isActive: true,
  };
}

async function graph(timezone?: LocationTimezone) {
  const s = await seedSite(cleanup);
  const loc = await seedLocation(cleanup, s.id, { timezone });
  const area = await seedWorkArea(cleanup, loc);
  const shift = await seedShift(cleanup, loc);
  return { site: s, loc, area, shift };
}

describe("location scope", () => {
  test("an admin sees only their own location, even when ?location= names another", async () => {
    const mine = await graph();
    const other = await graph();
    actor = sessionOf("admin", {
      siteId: mine.site.id,
      siteLocationId: mine.loc.id,
    });

    const props = await pageProps({ location: other.loc.id });

    expect(props.locationId).toBe(mine.loc.id);
    expect(props.locationOptions.map((o) => o.id)).toEqual([mine.loc.id]);
  });

  test("an ho picks among their own site's locations only", async () => {
    const mine = await graph();
    const sibling = await seedLocation(cleanup, mine.site.id);
    const foreign = await graph();
    actor = sessionOf("ho", { siteId: mine.site.id });

    const props = await pageProps({ location: sibling.id });
    expect(props.locationId).toBe(sibling.id);
    expect(new Set(props.locationOptions.map((o) => o.id))).toEqual(
      new Set([mine.loc.id, sibling.id]),
    );

    // A location of another site is not in scope: the pick falls back.
    const crafted = await pageProps({ location: foreign.loc.id });
    expect(crafted.locationId).not.toBe(foreign.loc.id);
    expect(crafted.locationOptions.map((o) => o.id)).not.toContain(
      foreign.loc.id,
    );
  });

  test("a superadmin picks among every live location, labelled Site / Location", async () => {
    const a = await graph();
    const b = await graph();
    const gone = await seedLocation(cleanup, b.site.id, { deleted: true });
    actor = sessionOf("superadmin");

    const props = await pageProps({ location: b.loc.id });

    expect(props.locationId).toBe(b.loc.id);
    const ids = props.locationOptions.map((o) => o.id);
    expect(ids).toContain(a.loc.id);
    expect(ids).toContain(b.loc.id);
    expect(ids).not.toContain(gone.id);
    expect(props.locationOptions.find((o) => o.id === b.loc.id)?.label).toBe(
      `${b.site.name} / ${b.loc.name}`,
    );
  });

  test("an ho without a site sees an empty state, not another site's data", async () => {
    actor = sessionOf("ho");

    const html = await pageHtml();

    expect(html).toContain("No location is available");
  });
});

describe("date", () => {
  test("without ?date the day is today in the location's own zone", async () => {
    const jakarta = await graph("Asia/Jakarta");
    const makassar = await graph("Asia/Makassar");
    actor = sessionOf("superadmin");
    // 16:30 UTC on the 29th: 23:30 in WIB, already the 30th in WITA.
    setSystemTime(new Date("2026-10-29T16:30:00Z"));

    expect((await pageProps({ location: jakarta.loc.id })).date).toBe(
      "2026-10-29",
    );
    expect((await pageProps({ location: makassar.loc.id })).date).toBe(
      "2026-10-30",
    );
  });

  test("a malformed or impossible ?date falls back to today without an error", async () => {
    const fx = await graph("Asia/Jakarta");
    actor = sessionOf("admin", { siteId: fx.site.id, siteLocationId: fx.loc.id });
    setSystemTime(new Date("2026-10-29T03:00:00Z"));

    for (const date of ["junk", "2026-02-30", "07-01-2026", "", "2026-1-7"]) {
      expect((await pageProps({ date })).date).toBe("2026-10-29");
    }
    expect((await pageProps({ date: ["2026-01-07", "x"] })).date).toBe(
      "2026-01-07",
    );
  });

  test("a valid ?date is used", async () => {
    const fx = await graph();
    actor = sessionOf("admin", { siteId: fx.site.id, siteLocationId: fx.loc.id });

    expect((await pageProps({ date: "2026-01-07" })).date).toBe("2026-01-07");
  });
});

describe("write surface", () => {
  test("canWrite is true for the admin and false for ho and superadmin", async () => {
    const fx = await graph();

    actor = sessionOf("admin", { siteId: fx.site.id, siteLocationId: fx.loc.id });
    expect((await pageProps()).canWrite).toBe(true);

    actor = sessionOf("ho", { siteId: fx.site.id });
    expect((await pageProps({ location: fx.loc.id })).canWrite).toBe(false);

    actor = sessionOf("superadmin");
    expect((await pageProps({ location: fx.loc.id })).canWrite).toBe(false);
  });

  test("a date after today in the location's zone sets future", async () => {
    const fx = await graph("Asia/Jakarta");
    actor = sessionOf("admin", { siteId: fx.site.id, siteLocationId: fx.loc.id });
    setSystemTime(new Date("2026-10-29T16:30:00Z"));

    expect((await pageProps({ date: "2026-10-30" })).future).toBe(true);
    expect((await pageProps({ date: "2026-10-29" })).future).toBe(false);
    expect((await pageProps({ date: "2026-01-07" })).future).toBe(false);
  });
});

describe("shift and area filters", () => {
  test("a shift or area of the location is kept", async () => {
    const fx = await graph();
    actor = sessionOf("admin", { siteId: fx.site.id, siteLocationId: fx.loc.id });

    const props = await pageProps({ shift: fx.shift.id, area: fx.area.id });

    expect(props.shiftId).toBe(fx.shift.id);
    expect(props.areaId).toBe(fx.area.id);
  });

  test("a value that is not a uuid, or belongs to another location, falls back to no filter", async () => {
    const fx = await graph();
    const other = await graph();
    actor = sessionOf("admin", { siteId: fx.site.id, siteLocationId: fx.loc.id });

    for (const [shift, area] of [
      ["junk", "junk"],
      [other.shift.id, other.area.id],
      [randomUUID(), randomUUID()],
    ]) {
      const props = await pageProps({ shift, area });
      expect(props.shiftId).toBeNull();
      expect(props.areaId).toBeNull();
    }
  });

  test("the loaded data carries the location's time zone", async () => {
    const fx = await graph("Asia/Jayapura");
    actor = sessionOf("admin", { siteId: fx.site.id, siteLocationId: fx.loc.id });

    expect((await pageProps()).data.timezone).toBe("Asia/Jayapura");
  });
});
