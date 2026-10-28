import { describe, expect, test } from "bun:test";

import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "./purge-copy";

describe("purgeDescription", () => {
  test("names the location and warns that it cannot be undone", () => {
    const text = purgeDescription("Cikarang Plant");

    expect(text).toContain("Cikarang Plant");
    expect(text).toContain("cannot be undone");
  });

  test("lists what goes with the location and what blocks the delete", () => {
    const text = purgeDescription("X");

    for (const part of ["work areas", "shifts", "workers", "users"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("live work areas, workers, shifts or users");
    expect(text).toContain("roster, request or audit history");
  });

  test("says that rows already deleted go too", () => {
    expect(purgeDescription("X")).toContain("including those already deleted");
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 locations");
    expect(text).toContain("cannot be undone");
  });

  test("a single location reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 location ");
  });

  test("says what makes a location be skipped", () => {
    const text = bulkPurgeDescription(2);

    expect(text).toContain("live work areas, workers, shifts or users");
    expect(text).toContain("roster, request or audit history");
  });

  test("says that rows already deleted go too", () => {
    expect(bulkPurgeDescription(2)).toContain(
      "including those already deleted",
    );
  });
});

describe("purgeSuccessMessage", () => {
  test("names the location that was deleted", () => {
    expect(purgeSuccessMessage("Cikarang Plant")).toBe(
      "“Cikarang Plant” deleted permanently",
    );
  });
});
