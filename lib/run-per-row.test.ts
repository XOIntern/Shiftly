import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { site } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { nounFor } from "@/lib/bulk-summary";
import { runPerRow } from "@/lib/run-per-row";
import { installCleanup } from "@/lib/test-cleanup";
import type { RowResult } from "@/types/deleted";

// Fixture teardown runs in afterEach / afterAll, so it still runs after a test
// times out (a per-test finally would not).
const fixtureCleanup = installCleanup();

const opts = {
  emptyMessage: "No sites selected.",
  noun: nounFor("site"),
  mapError: (err: unknown) => `mapped: ${(err as Error).message}`,
};

const ok = async (): Promise<RowResult> => ({ ok: true });

describe("runPerRow", () => {
  test("applies every distinct id when all succeed", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];

    const result = await runPerRow(ids, ok, opts);

    expect(result).toEqual({
      ok: true,
      applied: 3,
      blocked: 0,
      message: undefined,
    });
  });

  test("one refusal among three is blocked and the others still apply", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];

    const result = await runPerRow(
      ids,
      async (_tx, id) =>
        id === ids[1] ? { ok: false, message: "Not allowed" } : { ok: true },
      opts,
    );

    expect(result).toEqual({
      ok: true,
      applied: 2,
      blocked: 1,
      message: "1 site skipped: Not allowed",
    });
  });

  test("the first refusal's message rides back, with a plural noun", async () => {
    const ids: string[] = [randomUUID(), randomUUID()];
    const reasons =["first reason", "second reason"];

    const result = await runPerRow(
      ids,
      async (_tx, id) => ({
        ok: false,
        message: reasons[ids.indexOf(id)],
      }),
      opts,
    );

    expect(result).toEqual({
      ok: true,
      applied: 0,
      blocked: 2,
      message: "2 sites skipped: first reason",
    });
  });

  test("a thrown error counts as blocked with the mapError text", async () => {
    const ids = [randomUUID(), randomUUID()];

    const result = await runPerRow(
      ids,
      async (_tx, id) => {
        if (id === ids[0]) throw new Error("boom");
        return { ok: true };
      },
      opts,
    );

    expect(result).toEqual({
      ok: true,
      applied: 1,
      blocked: 1,
      message: "1 site skipped: mapped: boom",
    });
  });

  test("duplicate and malformed ids are ignored", async () => {
    const id = randomUUID();
    const seen: string[] = [];

    const result = await runPerRow(
      [id, id, "not-a-uuid"],
      async (_tx, row) => {
        seen.push(row);
        return { ok: true };
      },
      opts,
    );

    expect(seen).toEqual([id]);
    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
  });

  test("nothing left after filtering returns the empty message", async () => {
    expect(await runPerRow(["nope", "also-nope"], ok, opts)).toEqual({
      ok: false,
      message: "No sites selected.",
    });
    expect(await runPerRow([], ok, opts)).toEqual({
      ok: false,
      message: "No sites selected.",
    });
  });

  test("a validId override accepts non-uuid ids", async () => {
    const seen: string[] = [];

    const result = await runPerRow(
      ["a1", "b2", "bad id"],
      async (_tx, row) => {
        seen.push(row);
        return { ok: true };
      },
      { ...opts, validId: (id) => /^[a-z]\d$/.test(id) },
    );

    expect(seen).toEqual(["a1", "b2"]);
    expect(result.applied).toBe(2);
  });

  test("a refusal on one id does not roll back an earlier id", async () => {
    const first = randomUUID();
    const second = randomUUID();
    for (const id of [first, second]) {
      fixtureCleanup.defer(async () => {
        await db.delete(site).where(eq(site.id, id));
      });
    }

    const result = await runPerRow(
      [first, second],
      async (tx, id) => {
        if (id === second) return { ok: false, message: "Refused" };
        await tx
          .insert(site)
          .values({ id, name: `run-per-row-${id}`, isActive: false });
        return { ok: true };
      },
      opts,
    );

    expect(result).toEqual({
      ok: true,
      applied: 1,
      blocked: 1,
      message: "1 site skipped: Refused",
    });
    const rows = await db
      .select({ id: site.id })
      .from(site)
      .where(eq(site.id, first));
    expect(rows).toHaveLength(1);
  });
});
