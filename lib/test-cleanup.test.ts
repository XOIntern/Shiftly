import { afterEach, describe, expect, test } from "bun:test";

import { runTeardowns, installCleanup } from "./test-cleanup";

describe("runTeardowns", () => {
  test("runs the newest teardown first and empties the list", async () => {
    const order: string[] = [];
    const pending = [
      async () => void order.push("first registered"),
      async () => void order.push("second registered"),
    ];

    await runTeardowns(pending);

    expect(order).toEqual(["second registered", "first registered"]);
    expect(pending.length).toBe(0);
  });

  test("a failing teardown does not stop the others, and the first failure is rethrown", async () => {
    const ran: string[] = [];
    const pending = [
      async () => void ran.push("oldest"),
      async () => {
        throw new Error("middle failed");
      },
      async () => void ran.push("newest"),
    ];

    await expect(runTeardowns(pending)).rejects.toThrow("middle failed");

    expect(ran).toEqual(["newest", "oldest"]);
  });

  test("accepts synchronous teardowns", async () => {
    let ran = false;
    await runTeardowns([() => void (ran = true)]);
    expect(ran).toBe(true);
  });
});

// The hooks themselves. One test per group, so the check cannot depend on
// test order (--randomize shuffles tests within a file): the assertion sits in
// an afterEach registered after installCleanup's own, i.e. it runs right after
// the teardown would have. (The timeout case, where a per-test finally never
// runs, cannot be a committed test: bun reports the timed-out test as failed.)
describe("installCleanup hooks", () => {
  const cleanup = installCleanup();
  let ran = false;

  afterEach(() => {
    expect(ran).toBe(true);
  });

  test("a registered teardown has run once the test is over", () => {
    cleanup.defer(() => void (ran = true));
    expect(ran).toBe(false);
  });
});
