import "dotenv/config";
import { describe, expect, test } from "bun:test";

import { PURGE_COVERAGE } from "./site-purge";
import { purgeCoverageOffenders } from "./test-purge-coverage";

// Proves the shared check can fail: a coverage object that leaves out a real
// foreign-key child must be reported, and the real Sites coverage must not be.
describe("purgeCoverageOffenders", () => {
  test("names a foreign-key child that no group covers", async () => {
    const offenders = await purgeCoverageOffenders({
      purged: ["site"],
      history: [],
      cascade: [],
    });

    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((message) => message.startsWith("site_location -> site"))).toBe(true);
  });

  test("reports nothing for the real site coverage", async () => {
    expect(await purgeCoverageOffenders(PURGE_COVERAGE)).toEqual([]);
  });
});
