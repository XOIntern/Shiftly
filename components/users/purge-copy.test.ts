import { describe, expect, test } from "bun:test";

import {
  bulkPurgeDescription,
  purgeDescription,
  purgeSuccessMessage,
} from "./purge-copy";

describe("purgeDescription", () => {
  test("names the user and warns that it cannot be undone", () => {
    const text = purgeDescription("Budi Santoso");

    expect(text).toContain("Budi Santoso");
    expect(text).toContain("cannot be undone");
  });

  test("says that sessions and credentials go with the user", () => {
    expect(purgeDescription("X")).toContain(
      "sessions and credentials are removed with them",
    );
  });

  test("says what keeps a user from being deleted", () => {
    const text = purgeDescription("X");

    expect(text).toContain("audit log");
    expect(text).toContain("published a roster");
    expect(text).toContain("created a request");
  });
});

describe("bulkPurgeDescription", () => {
  test("names the count and warns it cannot be undone", () => {
    const text = bulkPurgeDescription(3);

    expect(text).toContain("3 users");
    expect(text).toContain("cannot be undone");
  });

  test("a single user reads in the singular", () => {
    expect(bulkPurgeDescription(1)).toContain("1 user ");
  });

  test("says what makes a user be skipped", () => {
    const text = bulkPurgeDescription(2);

    expect(text).toContain("audit log");
    expect(text).toContain("is skipped");
  });
});

describe("purgeSuccessMessage", () => {
  test("names the user that was deleted", () => {
    expect(purgeSuccessMessage("Budi Santoso")).toBe(
      "“Budi Santoso” deleted permanently",
    );
  });
});
