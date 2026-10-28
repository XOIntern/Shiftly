import { describe, expect, test } from "bun:test";

import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "./purge-copy";

describe("purgeDescription", () => {
  test("names the position and warns that it cannot be undone", () => {
    const text = purgeDescription("Cook");

    expect(text).toContain("Cook");
    expect(text).toContain("cannot be undone");
  });

  test("says what keeps a position from being deleted, deleted owners included", () => {
    const text = purgeDescription("X");

    expect(text).toContain("a worker holds or a work area requires");
    expect(text).toContain("deleted ones included");
    expect(text).toContain("appears on a request");
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 positions");
    expect(text).toContain("cannot be undone");
  });

  test("a single position reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 position ");
  });

  test("says what makes a position be skipped", () => {
    const text = bulkPurgeDescription(2);

    expect(text).toContain("a worker holds or a work area requires");
    expect(text).toContain("appears on a request");
    expect(text).toContain("is skipped");
  });
});

describe("purgeSuccessMessage", () => {
  test("names the position that was deleted", () => {
    expect(purgeSuccessMessage("Cook")).toBe("“Cook” deleted permanently");
  });
});
