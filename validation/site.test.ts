import { describe, expect, test } from "bun:test";
import { siteCreateSchema, siteUpdateSchema } from "./site";

describe("siteCreateSchema", () => {
  test("accepts a valid name", () => {
    const result = siteCreateSchema.safeParse({ name: "HQ Plant" });
    expect(result.success).toBe(true);
  });

  test("rejects an empty name", () => {
    const result = siteCreateSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a whitespace-only name", () => {
    const result = siteCreateSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the name", () => {
    const result = siteCreateSchema.safeParse({ name: "  HQ Plant  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("HQ Plant");
    }
  });

  test("accepts a name of exactly 100 chars", () => {
    const result = siteCreateSchema.safeParse({ name: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  test("rejects a name over 100 chars", () => {
    const result = siteCreateSchema.safeParse({ name: "x".repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe("siteUpdateSchema", () => {
  test("accepts a valid update with isActive", () => {
    const result = siteUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "HQ Plant",
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing isActive", () => {
    const result = siteUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "HQ Plant",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = siteUpdateSchema.safeParse({
      id: "not-a-uuid",
      name: "HQ Plant",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });
});
