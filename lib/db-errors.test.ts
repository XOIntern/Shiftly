import { describe, expect, test } from "bun:test";
import { mapDbError } from "./db-errors";

function pgError(code: string, constraint?: string): { code: string; constraint?: string } {
  return { code, ...(constraint ? { constraint } : {}) };
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
