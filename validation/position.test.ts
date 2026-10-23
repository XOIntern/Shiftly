import { describe, expect, test } from "bun:test";
import { positionCreateSchema, positionUpdateSchema } from "./position";

describe("positionCreateSchema", () => {
  test("accepts a name without a siteId (derived server-side)", () => {
    const result = positionCreateSchema.safeParse({ name: "Shift Leader" });
    expect(result.success).toBe(true);
  });

  test("accepts a uuid siteId", () => {
    const result = positionCreateSchema.safeParse({
      siteId: "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f",
      name: "Shift Leader",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a non-uuid siteId", () => {
    const result = positionCreateSchema.safeParse({
      siteId: "not-a-uuid",
      name: "Shift Leader",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = positionCreateSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a whitespace-only name", () => {
    const result = positionCreateSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the name", () => {
    const result = positionCreateSchema.safeParse({ name: "  Shift Leader  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Shift Leader");
    }
  });

  test("accepts a name of exactly 100 chars", () => {
    const result = positionCreateSchema.safeParse({ name: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  test("rejects a name over 100 chars", () => {
    const result = positionCreateSchema.safeParse({ name: "x".repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe("positionUpdateSchema", () => {
  test("accepts a valid update with isActive", () => {
    const result = positionUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Shift Leader",
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects a missing name", () => {
    const result = positionUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing isActive", () => {
    const result = positionUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Shift Leader",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = positionUpdateSchema.safeParse({
      id: "not-a-uuid",
      name: "Shift Leader",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });
});
