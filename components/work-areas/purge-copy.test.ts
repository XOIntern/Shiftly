import { describe, expect, test } from "bun:test";

import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "./purge-copy";

describe("purgeDescription", () => {
  test("names the work area and warns that it cannot be undone", () => {
    const text = purgeDescription("Kitchen");

    expect(text).toContain("Kitchen");
    expect(text).toContain("cannot be undone");
  });

  test("says that the links go with it and the positions stay", () => {
    const text = purgeDescription("X");

    expect(text).toContain("required-position links are removed with it");
    expect(text).toContain("the positions stay");
  });

  test("says what keeps a work area from being deleted", () => {
    expect(purgeDescription("X")).toContain("roster or request history");
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 work areas");
    expect(text).toContain("cannot be undone");
  });

  test("a single work area reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 work area ");
  });

  test("says what makes a work area be skipped", () => {
    const text = bulkPurgeDescription(2);

    expect(text).toContain("roster or request history");
    expect(text).toContain("is skipped");
  });
});

describe("purgeSuccessMessage", () => {
  test("names the work area that was deleted", () => {
    expect(purgeSuccessMessage("Kitchen")).toBe(
      "“Kitchen” deleted permanently",
    );
  });
});
