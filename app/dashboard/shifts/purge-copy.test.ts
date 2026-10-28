import { describe, expect, test } from "bun:test";

import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "./purge-copy";

describe("purgeDescription", () => {
  test("names the shift and warns that it cannot be undone", () => {
    const text = purgeDescription("Early");

    expect(text).toContain("Early");
    expect(text).toContain("cannot be undone");
  });

  test("says what keeps a shift from being deleted", () => {
    expect(purgeDescription("X")).toContain("roster or request history");
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 shifts");
    expect(text).toContain("cannot be undone");
  });

  test("a single shift reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 shift ");
  });

  test("says what makes a shift be skipped", () => {
    const text = bulkPurgeDescription(2);

    expect(text).toContain("roster or request history");
    expect(text).toContain("is skipped");
  });
});

describe("purgeSuccessMessage", () => {
  test("names the shift that was deleted", () => {
    expect(purgeSuccessMessage("Early")).toBe("“Early” deleted permanently");
  });
});
