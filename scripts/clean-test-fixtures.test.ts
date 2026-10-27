import { describe, expect, test } from "bun:test";

import {
  databaseName,
  isFixtureSiteName,
  isFixtureUserEmail,
} from "./clean-test-fixtures";

const ID = "4426bb87-bcc8-462e-be97-666af3b73e94";

describe("clean-test-fixtures pattern matching", () => {
  test("matches a fixture site only with the exact prefix and a uuid suffix", () => {
    expect(isFixtureSiteName(`t4-loc-fs-${ID}`)).toBe(true);
    expect(isFixtureSiteName("t4-loc-fs-")).toBe(false);
    expect(isFixtureSiteName("t4-loc-fs-warehouse")).toBe(false);
    expect(isFixtureSiteName(`t4-loc-fs-${ID}-copy`)).toBe(false);
    expect(isFixtureSiteName(`x-t4-loc-fs-${ID}`)).toBe(false);
    expect(isFixtureSiteName(`t4-loc-sc-alpha-${ID}`)).toBe(false);
  });

  test("matches fixture users by prefix, uuid and test address, never by domain alone", () => {
    expect(isFixtureUserEmail(`auth-guard-${ID}@shiftly.test`)).toBe(true);
    expect(isFixtureUserEmail(`t-mp-act-${ID}@shiftly.test`)).toBe(true);
    expect(isFixtureUserEmail("admin@shiftly.test")).toBe(false);
    expect(isFixtureUserEmail("auth-guard-someone@shiftly.test")).toBe(false);
    expect(isFixtureUserEmail(`auth-guard-${ID}@example.com`)).toBe(false);
    expect(isFixtureUserEmail(`t-mp-act-${ID}@shiftly.test.evil`)).toBe(false);
  });

  test("reads the database name out of DATABASE_URL", () => {
    expect(databaseName("postgresql://u:p@localhost:5432/shiftly_dev")).toBe(
      "shiftly_dev",
    );
    expect(databaseName(undefined)).toBe("(DATABASE_URL not set)");
    expect(databaseName("not a url")).toBe("(unparseable DATABASE_URL)");
  });
});
