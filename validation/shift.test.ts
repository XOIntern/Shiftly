import { describe, expect, test } from "bun:test";
import { shiftCreateSchema, shiftUpdateSchema } from "./shift";

const SITE_ID = "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f";
const SITE_LOCATION_ID = "d3e4f5a6-b7c8-4d9e-8f0a-2b3c4d5e6f7a";
const SHIFT_ID = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

const validCreate = {
  siteLocationId: SITE_LOCATION_ID,
  label: "Pagi",
  orderIndex: 1,
  startTime: "06:00",
  endTime: "14:00",
};

describe("shiftCreateSchema", () => {
  test("accepts a valid shift without a siteId (derived server-side)", () => {
    const result = shiftCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  test("accepts a uuid siteId", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, siteId: SITE_ID });
    expect(result.success).toBe(true);
  });

  test("rejects a non-uuid siteId", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, siteId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  test("rejects a missing siteLocationId", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, siteLocationId: undefined });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid siteLocationId", () => {
    const result = shiftCreateSchema.safeParse({
      ...validCreate,
      siteLocationId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty label", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, label: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a whitespace-only label", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, label: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the label", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, label: "  Pagi  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBe("Pagi");
    }
  });

  test("accepts a label of exactly 100 chars", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, label: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  test("rejects a label over 100 chars", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, label: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  test("rejects orderIndex 0 and 21", () => {
    expect(shiftCreateSchema.safeParse({ ...validCreate, orderIndex: 0 }).success).toBe(false);
    expect(shiftCreateSchema.safeParse({ ...validCreate, orderIndex: 21 }).success).toBe(false);
  });

  test("accepts boundary orderIndex 1 and 20", () => {
    expect(shiftCreateSchema.safeParse({ ...validCreate, orderIndex: 1 }).success).toBe(true);
    expect(shiftCreateSchema.safeParse({ ...validCreate, orderIndex: 20 }).success).toBe(true);
  });

  test("rejects a non-integer orderIndex", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, orderIndex: 1.5 });
    expect(result.success).toBe(false);
  });

  test("accepts boundary times 00:00 and 23:59", () => {
    const result = shiftCreateSchema.safeParse({
      ...validCreate,
      startTime: "00:00",
      endTime: "23:59",
    });
    expect(result.success).toBe(true);
  });

  test("rejects 24:00", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, startTime: "24:00" });
    expect(result.success).toBe(false);
  });

  test("rejects a time missing its leading zero", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, startTime: "7:30" });
    expect(result.success).toBe(false);
  });

  test("rejects a time without the colon separator", () => {
    const result = shiftCreateSchema.safeParse({ ...validCreate, endTime: "0800" });
    expect(result.success).toBe(false);
  });
});

describe("shiftUpdateSchema", () => {
  test("accepts a valid update with isActive", () => {
    const result = shiftUpdateSchema.safeParse({
      ...validCreate,
      id: SHIFT_ID,
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing isActive", () => {
    const result = shiftUpdateSchema.safeParse({
      ...validCreate,
      id: SHIFT_ID,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = shiftUpdateSchema.safeParse({
      ...validCreate,
      id: "not-a-uuid",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });
});
