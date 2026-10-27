import { describe, expect, test } from "bun:test";

import { runExclusive } from "@/lib/run-exclusive";

describe("runExclusive", () => {
  test("a second task started while the first is in flight is refused and never runs", async () => {
    const lock = { current: false };
    let release: () => void = () => {};
    const ran: string[] = [];

    const first = runExclusive(lock, async () => {
      ran.push("first");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const second = await runExclusive(lock, async () => {
      ran.push("second");
    });

    expect(second).toBe(false);
    expect(ran).toEqual(["first"]);

    release();
    expect(await first).toBe(true);
    expect(lock.current).toBe(false);
  });

  test("the lock is released after completion so the next task runs", async () => {
    const lock = { current: false };
    const ran: string[] = [];
    await runExclusive(lock, async () => void ran.push("a"));
    expect(await runExclusive(lock, async () => void ran.push("b"))).toBe(true);
    expect(ran).toEqual(["a", "b"]);
  });

  test("the lock is released when the task throws", async () => {
    const lock = { current: false };
    await expect(
      runExclusive(lock, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(lock.current).toBe(false);
    expect(await runExclusive(lock, async () => {})).toBe(true);
  });
});
