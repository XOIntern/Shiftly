import { describe, expect, test } from "bun:test";

import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "./purge-copy";

describe("purgeDescription", () => {
  test("names the site and warns that it cannot be undone", () => {
    const text = purgeDescription("Nestle Cikarang");

    expect(text).toContain("Nestle Cikarang");
    expect(text).toContain("cannot be undone");
  });

  test("lists what goes with the site and what blocks the delete", () => {
    const text = purgeDescription("X");

    for (const part of [
      "locations",
      "work areas",
      "positions",
      "shifts",
      "workers",
      "users",
    ]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("roster, request or audit history");
  });

  test("says that rows already deleted go too", () => {
    expect(purgeDescription("X")).toContain("including those already deleted");
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 sites");
    expect(text).toContain("cannot be undone");
  });

  test("a single site reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 site ");
  });

  test("says what goes with the sites and what makes one be skipped", () => {
    const text = bulkPurgeDescription(2);

    for (const part of ["locations", "workers", "users"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("roster, request or audit history");
  });

  test("says that rows already deleted go too", () => {
    expect(bulkPurgeDescription(2)).toContain(
      "including those already deleted",
    );
  });
});

describe("purgeSuccessMessage", () => {
  test("names the site that was deleted", () => {
    expect(purgeSuccessMessage("Nestle Cikarang")).toBe(
      "“Nestle Cikarang” deleted permanently",
    );
  });
});
