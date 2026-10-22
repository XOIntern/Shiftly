import { describe, expect, test } from "bun:test";
import { mapDbError, pgErrorCode } from "./db-errors";

// Synthetic errors shaped like real ones (a real PG error from the driver is
// an Error with these extra fields, and drizzle nests them via `cause`).
type FakePgError = Error & {
  code?: string;
  constraint?: string;
  cause?: FakePgError;
};

function pgError(code: string, constraint?: string): FakePgError {
  return { code, ...(constraint ? { constraint } : {}) } as FakePgError;
}

// Mimics drizzle 0.45's DrizzleQueryError: the driver's PG error arrives as
// err.cause, one or more levels below the error mapDbError receives.
function drizzleWrappedError(
  cause: FakePgError,
  causeChainDepth = 1,
): FakePgError {
  let wrapped: FakePgError = { ...cause };
  for (let i = 0; i < causeChainDepth; i++) {
    wrapped = { message: "something failed", cause: wrapped } as FakePgError;
  }
  return wrapped;
}

describe("mapDbError", () => {
  test("email kind: 23505 maps to the email message", () => {
    const result = mapDbError(pgError("23505"), { kind: "email" });
    expect(result).toBe("Email already in use");
  });

  test("site-name kind: 23505 maps to the site name message", () => {
    const result = mapDbError(pgError("23505"), { kind: "site-name" });
    expect(result).toBe("A site with this name already exists");
  });

  test("location-name kind: 23505 maps to the location name message", () => {
    const result = mapDbError(pgError("23505"), { kind: "location-name" });
    expect(result).toBe("Location name already exists");
  });

  test("work-area-name kind: 23505 maps to the work area name message", () => {
    const result = mapDbError(pgError("23505"), { kind: "work-area-name" });
    expect(result).toBe("Work area name already exists");
  });

  test("new kinds wrapped through the cause chain still map", () => {
    expect(
      mapDbError(drizzleWrappedError(pgError("23505")), {
        kind: "work-area-name",
      }),
    ).toBe("Work area name already exists");
  });

  test("new kinds: 23503 still maps to the reference message", () => {
    expect(mapDbError(pgError("23503"), { kind: "work-area-name" })).toBe(
      "Some records still reference this item",
    );
  });

  test("any kind: 23503 maps to the reference message", () => {
    for (const kind of ["email", "site-name", "location-name"] as const) {
      const result = mapDbError(pgError("23503"), { kind });
      expect(result).toBe("Some records still reference this item");
    }
  });

  test("wrapped 23505 location-name kind: maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505")), {
      kind: "location-name",
    });
    expect(result).toBe("Location name already exists");
  });

  test("wrapped 23505 email kind: maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505")), {
      kind: "email",
    });
    expect(result).toBe("Email already in use");
  });

  test("wrapped 23505 site-name kind: maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505")), {
      kind: "site-name",
    });
    expect(result).toBe("A site with this name already exists");
  });

  test("wrapped 23503 maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23503")), {
      kind: "email",
    });
    expect(result).toBe("Some records still reference this item");
  });

  test("wrapped errors two levels deep still map", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505"), 2), {
      kind: "email",
    });
    expect(result).toBe("Email already in use");
  });

  describe("real drizzle DrizzleQueryError instance", () => {
    test("wraps the PG driver error so a mapped message comes out", async () => {
      const { DrizzleQueryError } = await import("drizzle-orm");
      const err = new DrizzleQueryError(
        "INSERT INTO ...",
        [],
        pgError("23505"),
      );
      expect(mapDbError(err, { kind: "email" })).toBe("Email already in use");
    });
  });

  test("other PG codes map to null", () => {
    expect(mapDbError(pgError("23502"), { kind: "site-name" })).toBe(null);
    expect(mapDbError(pgError("42P01"), { kind: "email" })).toBe(null);
  });

  test("errors without a code map to null", () => {
    expect(mapDbError(new Error("boom"), { kind: "site-name" })).toBe(null);
    expect(mapDbError(null, { kind: "email" })).toBe(null);
    expect(mapDbError(undefined, { kind: "site-name" })).toBe(null);
    expect(mapDbError("string error", { kind: "email" })).toBe(null);
  });
});

// users/actions.ts detects FK violations (23503) through this walk —
// never via a raw `err.code` read, which is dead once drizzle wraps the
// driver error in DrizzleQueryError.
describe("pgErrorCode", () => {
  test("bare driver error: code is on the object", () => {
    expect(pgErrorCode(pgError("23503"))).toBe("23503");
  });

  test("wrapped driver error: code found through the cause chain", () => {
    const err = drizzleWrappedError(pgError("23503"));
    expect(err.code).toBeUndefined();
    expect(pgErrorCode(err)).toBe("23503");
  });

  test("wrapped two levels deep still found", () => {
    const err = drizzleWrappedError(pgError("23505"), 2);
    expect(pgErrorCode(err)).toBe("23505");
  });

  test("real drizzle DrizzleQueryError instance wraps the code", async () => {
    const { DrizzleQueryError } = await import("drizzle-orm");
    const err = new DrizzleQueryError("UPDATE ...", [], pgError("23503"));
    expect(pgErrorCode(err)).toBe("23503");
  });

  test("no code anywhere in the chain maps to undefined", () => {
    expect(pgErrorCode(new Error("boom"))).toBeUndefined();
    expect(pgErrorCode({ message: "no code" })).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
  });

  test("cycle in the cause chain terminates", () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = {};
    a.cause = b;
    b.cause = a;
    expect(pgErrorCode(a)).toBeUndefined();
  });

  test("code above the depth limit is not found", () => {
    const err = drizzleWrappedError(pgError("23503"), 10);
    expect(pgErrorCode(err)).toBeUndefined();
  });
});
