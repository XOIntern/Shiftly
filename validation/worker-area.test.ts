import { describe, expect, test } from "bun:test";
import { workAreaCreateSchema, workAreaUpdateSchema } from "./worker-area";

const SITE_ID = "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f";
const SITE_LOCATION_ID = "d3e4f5a6-b7c8-4d9e-8f0a-2b3c4d5e6f7a";
const WORK_AREA_ID = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";
const POSITION_ID_A = "f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c";
const POSITION_ID_B = "0e1f2a3b-4c5d-4e6f-9a0b-1c2d3e4f5a6b";

const positionIdAt = (n: number) =>
  `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const base = {
  siteLocationId: SITE_LOCATION_ID,
  name: "Line 1",
};

const validCreate = { ...base, requiredPositionIds: [POSITION_ID_A] };

describe("workAreaCreateSchema", () => {
  test("accepts a valid work area without a siteId (derived server-side)", () => {
    const result = workAreaCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  test("accepts a uuid siteId", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, siteId: SITE_ID });
    expect(result.success).toBe(true);
  });

  test("rejects a non-uuid siteId", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, siteId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  test("rejects a missing siteLocationId on the field", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, siteLocationId: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("siteLocationId"))).toBe(true);
    }
  });

  test("rejects a non-uuid siteLocationId", () => {
    const result = workAreaCreateSchema.safeParse({
      ...validCreate,
      siteLocationId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a whitespace-only name", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, name: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the name", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, name: "  Line 1  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Line 1");
    }
  });

  test("accepts a name of exactly 100 chars", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, name: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  test("rejects a name over 100 chars", () => {
    const result = workAreaCreateSchema.safeParse({ ...validCreate, name: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  test("rejects a missing requiredPositionIds on the field", () => {
    const result = workAreaCreateSchema.safeParse({
      ...validCreate,
      requiredPositionIds: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes("requiredPositionIds")),
      ).toBe(true);
    }
  });

  test("rejects an empty requiredPositionIds array", () => {
    const result = workAreaCreateSchema.safeParse({
      ...validCreate,
      requiredPositionIds: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects duplicate requiredPositionIds with the once-only message", () => {
    const result = workAreaCreateSchema.safeParse({
      ...validCreate,
      requiredPositionIds: [POSITION_ID_A, POSITION_ID_A],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["requiredPositionIds"]);
      expect(result.error.issues[0].message).toBe("Select each position once");
    }
  });

  test("accepts 1 to 20 required positions and rejects 21", () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => positionIdAt(i));
    for (const count of [1, 20]) {
      expect(
        workAreaCreateSchema.safeParse({
          ...validCreate,
          requiredPositionIds: ids(count),
        }).success,
      ).toBe(true);
    }
    expect(
      workAreaCreateSchema.safeParse({
        ...validCreate,
        requiredPositionIds: ids(21),
      }).success,
    ).toBe(false);
  });

  test("rejects a non-uuid entry in requiredPositionIds", () => {
    const result = workAreaCreateSchema.safeParse({
      ...validCreate,
      requiredPositionIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });
});

describe("workAreaUpdateSchema", () => {
  test("accepts a valid update with isActive and no requiredPositionIds", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: WORK_AREA_ID,
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing isActive", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: WORK_AREA_ID,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: "not-a-uuid",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  test("accepts requiredPositionIds", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: WORK_AREA_ID,
      isActive: true,
      requiredPositionIds: [POSITION_ID_A, POSITION_ID_B],
    });
    expect(result.success).toBe(true);
  });

  test("accepts an empty requiredPositionIds array", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: WORK_AREA_ID,
      isActive: true,
      requiredPositionIds: [],
    });
    expect(result.success).toBe(true);
  });

  test("rejects duplicate requiredPositionIds with the once-only message", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: WORK_AREA_ID,
      isActive: true,
      requiredPositionIds: [POSITION_ID_A, POSITION_ID_A],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["requiredPositionIds"]);
      expect(result.error.issues[0].message).toBe("Select each position once");
    }
  });

  test("accepts 20 required positions and rejects 21", () => {
    const ids = (count: number) =>
      Array.from({ length: count }, (_, i) => positionIdAt(i));
    expect(
      workAreaUpdateSchema.safeParse({
        ...base,
        id: WORK_AREA_ID,
        isActive: true,
        requiredPositionIds: ids(20),
      }).success,
    ).toBe(true);
    expect(
      workAreaUpdateSchema.safeParse({
        ...base,
        id: WORK_AREA_ID,
        isActive: true,
        requiredPositionIds: ids(21),
      }).success,
    ).toBe(false);
  });

  test("rejects a non-uuid entry in requiredPositionIds", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: WORK_AREA_ID,
      isActive: true,
      requiredPositionIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  test("keeps the create rules: a missing siteLocationId still fails", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      siteLocationId: undefined,
      id: WORK_AREA_ID,
      isActive: true,
    });
    expect(result.success).toBe(false);
  });
});
