import { describe, expect, test } from "bun:test";
import { workerCreateSchema, workerUpdateSchema } from "./worker";

const SITE_ID = "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f";
const SITE_LOCATION_ID = "d3e4f5a6-b7c8-4d9e-8f0a-2b3c4d5e6f7a";
const WORKER_ID = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";
const POSITION_ID_A = "f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c";
const POSITION_ID_B = "0e1f2a3b-4c5d-4e6f-9a0b-1c2d3e4f5a6b";

const validCreate = {
  siteLocationId: SITE_LOCATION_ID,
  employeeId: "EMP-001",
  name: "Budi Santoso",
  positionIds: [POSITION_ID_A],
  contractEndDate: "2026-12-31",
};

describe("workerCreateSchema", () => {
  test("accepts a valid worker without a siteId (derived server-side)", () => {
    const result = workerCreateSchema.safeParse(validCreate);
    expect(result.success).toBe(true);
  });

  test("accepts a uuid siteId", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, siteId: SITE_ID });
    expect(result.success).toBe(true);
  });

  test("rejects a non-uuid siteId", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, siteId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  test("rejects a missing siteLocationId on the field", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, siteLocationId: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("siteLocationId"))).toBe(true);
    }
  });

  test("rejects a non-uuid siteLocationId", () => {
    const result = workerCreateSchema.safeParse({
      ...validCreate,
      siteLocationId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty employeeId", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, employeeId: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a whitespace-only employeeId", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, employeeId: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the employeeId", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, employeeId: "  EMP-001  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.employeeId).toBe("EMP-001");
    }
  });

  test("accepts an employeeId of exactly 100 chars", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, employeeId: "x".repeat(100) });
    expect(result.success).toBe(true);
  });

  test("rejects an employeeId over 100 chars", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, employeeId: "x".repeat(101) });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a whitespace-only name", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, name: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the name", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, name: "  Budi Santoso  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Budi Santoso");
    }
  });

  test("rejects an empty positionIds array on the field", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, positionIds: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("positionIds"))).toBe(true);
    }
  });

  test("rejects a non-uuid entry in positionIds", () => {
    const result = workerCreateSchema.safeParse({
      ...validCreate,
      positionIds: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  test("rejects duplicate positionIds with the once-only message", () => {
    const result = workerCreateSchema.safeParse({
      ...validCreate,
      positionIds: [POSITION_ID_A, POSITION_ID_A],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["positionIds"]);
      expect(result.error.issues[0].message).toBe("Select each position once");
    }
  });

  test("accepts multiple distinct positionIds", () => {
    const result = workerCreateSchema.safeParse({
      ...validCreate,
      positionIds: [POSITION_ID_A, POSITION_ID_B],
    });
    expect(result.success).toBe(true);
  });

  test("rejects a missing contractEndDate with the required message", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, contractEndDate: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["contractEndDate"]);
      expect(result.error.issues[0].message).toBe("Contract end is required");
    }
  });

  test("rejects an empty contractEndDate with the required message", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, contractEndDate: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Contract end is required");
    }
  });

  test("accepts a YYYY-MM-DD contractEndDate", () => {
    const result = workerCreateSchema.safeParse({
      ...validCreate,
      contractEndDate: "2027-01-15",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a contractEndDate without zero padding", () => {
    const result = workerCreateSchema.safeParse({ ...validCreate, contractEndDate: "2027-1-5" });
    expect(result.success).toBe(false);
  });

  test("rejects a contractEndDate with slash separators", () => {
    const result = workerCreateSchema.safeParse({
      ...validCreate,
      contractEndDate: "2027/01/15",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a contractEndDate wrapped in whitespace", () => {
    const result = workerCreateSchema.safeParse({
      ...validCreate,
      contractEndDate: " 2027-01-15 ",
    });
    expect(result.success).toBe(false);
  });
});

describe("workerUpdateSchema", () => {
  test("accepts a valid update with isActive", () => {
    const result = workerUpdateSchema.safeParse({
      ...validCreate,
      id: WORKER_ID,
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing isActive", () => {
    const result = workerUpdateSchema.safeParse({
      ...validCreate,
      id: WORKER_ID,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a missing id on the id field", () => {
    const result = workerUpdateSchema.safeParse({
      ...validCreate,
      id: undefined,
      isActive: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("id"))).toBe(true);
    }
  });

  test("rejects a non-uuid id", () => {
    const result = workerUpdateSchema.safeParse({
      ...validCreate,
      id: "not-a-uuid",
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  test("keeps the create rules: an empty positionIds array still fails", () => {
    const result = workerUpdateSchema.safeParse({
      ...validCreate,
      id: WORKER_ID,
      isActive: true,
      positionIds: [],
    });
    expect(result.success).toBe(false);
  });
});
