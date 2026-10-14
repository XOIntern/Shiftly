import { describe, expect, test } from "bun:test";
import { mapDbError } from "./db-errors";

// Synthetic errors shaped like real ones (a real PG error from the driver is
// an Error with these extra fields, and drizzle nests them via `cause`).
type FakePgError = Error & { code?: string; constraint?: string; cause?: FakePgError };

function pgError(code: string, constraint?: string): FakePgError {
  return { code, ...(constraint ? { constraint } : {}) } as FakePgError;
}

// Mimics drizzle 0.45's DrizzleQueryError: the driver's PG error arrives as
// err.cause, one or more levels below the error mapDbError receives.
function drizzleWrappedError(cause: FakePgError, causeChainDepth = 1): FakePgError {
  let wrapped: FakePgError = { ...cause };
  for (let i = 0; i < causeChainDepth; i++) {
    wrapped = { message: "something failed", cause: wrapped } as FakePgError;
  }
  return wrapped;
}

describe("mapDbError", () => {
  test("name kind: 23505 maps to the client name message", () => {
    const result = mapDbError(pgError("23505"), { kind: "name" });
    expect(result).toBe("A client with this name already exists");
  });

  test("email kind: 23505 maps to the email message", () => {
    const result = mapDbError(pgError("23505"), { kind: "email" });
    expect(result).toBe("Email already in use");
  });

  test("site-name kind: 23505 maps to the site name message", () => {
    const result = mapDbError(pgError("23505"), { kind: "site-name" });
    expect(result).toBe("A site with this name already exists for this client");
  });

  test("any kind: 23503 maps to the reference message", () => {
    for (const kind of ["name", "email", "site-name"] as const) {
      const result = mapDbError(pgError("23503"), { kind });
      expect(result).toBe("Some records still reference this item");
    }
  });

  test("wrapped 23505 name kind: maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505")), { kind: "name" });
    expect(result).toBe("A client with this name already exists");
  });

  test("wrapped 23505 email kind: maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505")), { kind: "email" });
    expect(result).toBe("Email already in use");
  });

  test("wrapped 23505 site-name kind: maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505")), { kind: "site-name" });
    expect(result).toBe("A site with this name already exists for this client");
  });

  test("wrapped 23503 maps through the cause chain", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23503")), { kind: "name" });
    expect(result).toBe("Some records still reference this item");
  });

  test("wrapped errors two levels deep still map", () => {
    const result = mapDbError(drizzleWrappedError(pgError("23505"), 2), { kind: "email" });
    expect(result).toBe("Email already in use");
  });

  describe("real drizzle DrizzleQueryError instance", () => {
    test("wraps the PG driver error so a mapped message comes out", async () => {
      const { DrizzleQueryError } = await import("drizzle-orm");
      const err = new DrizzleQueryError("INSERT INTO ...", [], pgError("23505"));
      expect(mapDbError(err, { kind: "email" })).toBe("Email already in use");
    });
  });

  test("other PG codes map to null", () => {
    expect(mapDbError(pgError("23502"), { kind: "name" })).toBe(null);
    expect(mapDbError(pgError("42P01"), { kind: "email" })).toBe(null);
  });

  test("errors without a code map to null", () => {
    expect(mapDbError(new Error("boom"), { kind: "name" })).toBe(null);
    expect(mapDbError(null, { kind: "email" })).toBe(null);
    expect(mapDbError(undefined, { kind: "site-name" })).toBe(null);
    expect(mapDbError("string error", { kind: "name" })).toBe(null);
  });
});
