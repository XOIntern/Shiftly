import { describe, expect, test } from "bun:test";

import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "./purge-copy";

describe("purgeDescription", () => {
  test("names the worker and warns that it cannot be undone", () => {
    const text = purgeDescription("Budi Santoso");

    expect(text).toContain("Budi Santoso");
    expect(text).toContain("cannot be undone");
  });

  test("says that the links go with the worker and the positions stay", () => {
    const text = purgeDescription("X");

    expect(text).toContain("position links are removed with them");
    expect(text).toContain("the positions stay");
  });

  test("says what keeps a worker from being deleted", () => {
    expect(purgeDescription("X")).toContain("roster history");
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 workers");
    expect(text).toContain("cannot be undone");
  });

  test("a single worker reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 worker ");
  });

  test("says what makes a worker be skipped", () => {
    const text = bulkPurgeDescription(2);

    expect(text).toContain("roster history");
    expect(text).toContain("is skipped");
  });
});

describe("purgeSuccessMessage", () => {
  test("names the worker that was deleted", () => {
    expect(purgeSuccessMessage("Budi Santoso")).toBe(
      "“Budi Santoso” deleted permanently",
    );
  });
});
