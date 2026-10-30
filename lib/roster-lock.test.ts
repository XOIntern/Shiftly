import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { db } from "@/lib/db";
import { lockRosterLocation } from "@/lib/roster-lock";

// A promise that is pending until released, so a test can hold a transaction
// open for exactly as long as it needs.
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const tick = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

// Settles to "waiting" if `p` has not finished after the tick.
async function state(p: Promise<unknown>): Promise<"done" | "waiting"> {
  return Promise.race([p.then(() => "done" as const), tick().then(() => "waiting" as const)]);
}

describe("lockRosterLocation", () => {
  test("a second transaction on the same location waits for the first to end", async () => {
    const location = randomUUID();
    const hold = gate();
    const held = gate();

    const first = db.transaction(async (tx) => {
      await lockRosterLocation(tx, location);
      held.open();
      await hold.promise;
    });
    await held.promise;

    const second = db.transaction(async (tx) => {
      await lockRosterLocation(tx, location);
    });

    expect(await state(second)).toBe("waiting");
    hold.open();
    await first;
    await second;
  });

  test("a transaction on another location is not blocked", async () => {
    const hold = gate();
    const held = gate();

    const first = db.transaction(async (tx) => {
      await lockRosterLocation(tx, randomUUID());
      held.open();
      await hold.promise;
    });
    await held.promise;

    const other = db.transaction(async (tx) => {
      await lockRosterLocation(tx, randomUUID());
    });

    expect(await state(other)).toBe("done");
    hold.open();
    await first;
  });
});
