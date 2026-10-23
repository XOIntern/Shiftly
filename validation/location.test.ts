import { describe, expect, test } from "bun:test";
import { locationCreateSchema, locationUpdateSchema } from "./location";

describe("locationCreateSchema", () => {
  test("accepts a name without a siteId (derived server-side)", () => {
    const result = locationCreateSchema.safeParse({ name: "Warehouse A" });
    expect(result.success).toBe(true);
  });

  test("accepts a uuid siteId", () => {
    const result = locationCreateSchema.safeParse({
      siteId: "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f",
      name: "Warehouse A",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a non-uuid siteId", () => {
    const result = locationCreateSchema.safeParse({
      siteId: "not-a-uuid",
      name: "Warehouse A",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = locationCreateSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a whitespace-only name", () => {
    const result = locationCreateSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the name", () => {
    const result = locationCreateSchema.safeParse({ name: "  Warehouse A  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Warehouse A");
    }
  });

  test("accepts a name of exactly 100 chars", () => {
    const result = locationCreateSchema.safeParse({ name: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  test("rejects a name over 100 chars", () => {
    const result = locationCreateSchema.safeParse({ name: "x".repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe("locationUpdateSchema", () => {
  test("accepts a valid update with isActive", () => {
    const result = locationUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Warehouse A",
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects a missing name", () => {
    const result = locationUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing isActive", () => {
    const result = locationUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Warehouse A",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = locationUpdateSchema.safeParse({
      id: "not-a-uuid",
      name: "Warehouse A",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });
});
