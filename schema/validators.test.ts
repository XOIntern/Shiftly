import { describe, expect, test } from "bun:test";
import {
  departmentCreateSchema,
  departmentUpdateSchema,
  workAreaCreateSchema,
  workAreaUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
  userCreateSchema,
  userPasswordSchema,
  changePasswordSchema,
  parseUserCreate,
  parseUserUpdate,
  userUpdateSchema,
  locationCreateSchema,
  locationUpdateSchema,
} from "./validators";

describe("departmentCreateSchema", () => {
  test("accepts valid input with a siteId", () => {
    const result = departmentCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Logistics",
    });
    expect(result.success).toBe(true);
  });

  test("accepts input without a siteId", () => {
    const result = departmentCreateSchema.safeParse({ name: "Logistics" });
    expect(result.success).toBe(true);
  });

  test("rejects an empty name", () => {
    const result = departmentCreateSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid siteId", () => {
    const result = departmentCreateSchema.safeParse({
      siteId: "nope",
      name: "Logistics",
    });
    expect(result.success).toBe(false);
  });
});

describe("departmentUpdateSchema", () => {
  const base = {
    id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    name: "Logistics",
    isActive: true,
  };

  test("accepts a valid update", () => {
    const result = departmentUpdateSchema.safeParse({
      ...base,
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an update without a siteId", () => {
    const result = departmentUpdateSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test("rejects a missing isActive", () => {
    const result = departmentUpdateSchema.safeParse({
      id: base.id,
      name: base.name,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = departmentUpdateSchema.safeParse({ ...base, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("workAreaCreateSchema", () => {
  test("accepts valid input with a departmentId", () => {
    const result = workAreaCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      departmentId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
      name: "Line 1",
    });
    expect(result.success).toBe(true);
  });

  test("accepts input with only a departmentId and a name", () => {
    const result = workAreaCreateSchema.safeParse({
      departmentId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      name: "Line 1",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a missing departmentId", () => {
    const result = workAreaCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Line 1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid departmentId", () => {
    const result = workAreaCreateSchema.safeParse({
      departmentId: "not-a-uuid",
      name: "Line 1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid siteLocationId", () => {
    const result = workAreaCreateSchema.safeParse({
      departmentId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      siteLocationId: "nope",
      name: "Line 1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = workAreaCreateSchema.safeParse({
      departmentId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("workAreaUpdateSchema", () => {
  const base = {
    id: "8e4c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b05",
    departmentId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    name: "Line 1",
    isActive: true,
  };

  test("accepts a valid update", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an update with only id, departmentId, name, isActive", () => {
    const result = workAreaUpdateSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test("rejects a missing isActive", () => {
    const result = workAreaUpdateSchema.safeParse({
      id: base.id,
      departmentId: base.departmentId,
      name: base.name,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a missing departmentId", () => {
    const result = workAreaUpdateSchema.safeParse({
      id: base.id,
      name: base.name,
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = workAreaUpdateSchema.safeParse({ ...base, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("siteCreateSchema", () => {
  test("accepts a valid name", () => {
    const result = siteCreateSchema.safeParse({ name: "HQ Plant" });
    expect(result.success).toBe(true);
  });

  test("rejects an empty name", () => {
    const result = siteCreateSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("rejects a name over 200 chars", () => {
    const result = siteCreateSchema.safeParse({ name: "x".repeat(201) });
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

describe("locationCreateSchema", () => {
  test("accepts valid location input with a siteId", () => {
    const result = locationCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Main Warehouse",
    });
    expect(result.success).toBe(true);
  });

  test("accepts input without a siteId", () => {
    const result = locationCreateSchema.safeParse({
      name: "Main Warehouse",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an empty name", () => {
    const result = locationCreateSchema.safeParse({
      name: "",
    });
    expect(result.success).toBe(false);
  });

  test("accepts input without an address (address field removed)", () => {
    const result = locationCreateSchema.safeParse({
      name: "Main Warehouse",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a non-uuid siteId", () => {
    const result = locationCreateSchema.safeParse({
      siteId: "nope",
      name: "Main Warehouse",
    });
    expect(result.success).toBe(false);
  });
});

describe("locationUpdateSchema", () => {
  const base = {
    id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    name: "Main Warehouse",
    isActive: true,
  };

  test("accepts a valid update", () => {
    const result = locationUpdateSchema.safeParse({
      ...base,
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an update without a siteId", () => {
    const result = locationUpdateSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test("rejects a missing isActive", () => {
    const result = locationUpdateSchema.safeParse({
      id: base.id,
      name: base.name,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = locationUpdateSchema.safeParse({ ...base, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("userCreateSchema", () => {
  test("accepts a superadmin user without bindings", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough1",
      role: "superadmin",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an ho user with siteId and no siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an admin user with siteLocationId and no siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "admin",
      siteLocationId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a short password", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "abc",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid email", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "not-an-email",
      password: "longenough1",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unknown role", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "worker",
    });
    expect(result.success).toBe(false);
  });

  test("rejects superadmin with a siteId binding", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough1",
      role: "superadmin",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    });
    expect(result.success).toBe(false);
  });

  test("rejects superadmin with a siteLocationId binding", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough1",
      role: "superadmin",
      siteLocationId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ho without siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ho with siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      siteLocationId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(false);
  });

  test("rejects admin without siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  test("rejects admin with siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "admin",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      siteLocationId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(false);
  });

  test("rejects admin with an empty string siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "admin",
      siteLocationId: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("userPasswordSchema", () => {
  test("accepts a password of 8 chars or more", () => {
    expect(userPasswordSchema.safeParse({ newPassword: "12345678" }).success).toBe(true);
  });

  test("rejects a short password", () => {
    expect(userPasswordSchema.safeParse({ newPassword: "1234567" }).success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  test("accepts a current and an 8-char new password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "old-pass",
      newPassword: "12345678",
    });
    expect(result.success).toBe(true);
  });

  test("accepts a new password different from the current one", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "old-pass",
      newPassword: "different-pass",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a 7-char newPassword", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "old-pass",
      newPassword: "1234567",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unchanged-password change", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "same-pass",
      newPassword: "same-pass",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["newPassword"],
          message: "New password must be different from the current password.",
        }),
      );
    }
  });

  test("rejects an empty currentPassword", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "",
      newPassword: "12345678",
    });
    expect(result.success).toBe(false);
  });
});

describe("userUpdateSchema", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

  test("does not require an email or password", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "Site Admin",
      role: "admin",
      siteLocationId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(true);
  });

  test("parses an ho edit with a siteId", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "HO",
      role: "ho",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.siteId).toBe("6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02");
  });

  test("still rejects ho with a siteLocationId", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "HO",
      role: "ho",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ho without a siteId", () => {
    const result = userUpdateSchema.safeParse({ id, name: "HO", role: "ho" });
    expect(result.success).toBe(false);
  });

  test("rejects admin with a siteId", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "Site Admin",
      role: "admin",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    });
    expect(result.success).toBe(false);
  });

  test("rejects admin without a siteLocationId", () => {
    const result = userUpdateSchema.safeParse({ id, name: "Site Admin", role: "admin" });
    expect(result.success).toBe(false);
  });

  test("rejects superadmin with a binding", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "Root",
      role: "superadmin",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(false);
  });
});

describe("parseUserUpdate", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

  test("strips a stale siteLocationId when the role is ho, keeping siteId", () => {
    const parsed = parseUserUpdate(id, {
      name: "HO",
      role: "ho",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBe("6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02");
      expect(parsed.data.siteLocationId).toBeUndefined();
    }
  });

  test("keeps the siteId when the role is ho", () => {
    const parsed = parseUserUpdate(id, {
      name: "HO",
      role: "ho",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.siteId).toBe("6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02");
  });

  test("strips siteId and keeps siteLocationId when the role is admin", () => {
    const parsed = parseUserUpdate(id, {
      name: "Site Admin",
      role: "admin",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBeUndefined();
      expect(parsed.data.siteLocationId).toBe("7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04");
    }
  });

  test("strips both bindings when the role is superadmin (moves to global)", () => {
    const parsed = parseUserUpdate(id, {
      name: "Root",
      role: "superadmin",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBeUndefined();
      expect(parsed.data.siteLocationId).toBeUndefined();
    }
  });

  test("rejects an unknown role", () => {
    const parsed = parseUserUpdate(id, { name: "X", role: "worker" });
    expect(parsed.success).toBe(false);
  });

  test("rejects admin without a siteLocationId (does not strip)", () => {
    const parsed = parseUserUpdate(id, { name: "X", role: "admin" });
    expect(parsed.success).toBe(false);
  });

  test("rejects ho without a siteId (does not strip)", () => {
    const parsed = parseUserUpdate(id, { name: "X", role: "ho" });
    expect(parsed.success).toBe(false);
  });

  test("accepts a Better Auth generated id that is not a UUID", () => {
    const parsed = parseUserUpdate("2PcXgGrgbhG1kjiIw3RNpdfWrKA9g5t2", {
      name: "HO",
      role: "ho",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("parseUserCreate", () => {
  const base = {
    name: "Site Admin",
    email: "site@shiftly.test",
    password: "longenough1",
  };
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";

  test("admin with a null siteLocationId fails per-field on siteLocationId", () => {
    const parsed = parseUserCreate({ ...base, role: "admin", siteLocationId: null });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("siteLocationId");
    }
  });

  test("admin without a siteLocationId still fails the refine", () => {
    const parsed = parseUserCreate({ ...base, role: "admin" });
    expect(parsed.success).toBe(false);
  });

  test("admin with a siteLocationId parses with siteId stripped", () => {
    const parsed = parseUserCreate({ ...base, role: "admin", siteLocationId: locUuid });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteLocationId).toBe(locUuid);
      expect(parsed.data.siteId).toBeUndefined();
    }
  });

  test("ho creation with a null siteId fails per-field on siteId", () => {
    const parsed = parseUserCreate({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: null,
      siteLocationId: null,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("siteId");
    }
  });

  test("ho creation with a supplied siteId parses, siteLocationId stripped", () => {
    const parsed = parseUserCreate({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: siteUuid,
      siteLocationId: locUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBe(siteUuid);
      expect(parsed.data.siteLocationId).toBeUndefined();
    }
  });

  test("superadmin creation with stray bindings strips both", () => {
    const parsed = parseUserCreate({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough1",
      role: "superadmin",
      siteId: siteUuid,
      siteLocationId: locUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBeUndefined();
      expect(parsed.data.siteLocationId).toBeUndefined();
    }
  });

  test("create schema itself is unchanged: ho without a siteId still rejected", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("create schema itself is unchanged: admin with a siteId still rejected", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "admin",
      siteId: siteUuid,
      siteLocationId: locUuid,
    });
    expect(result.success).toBe(false);
  });
});

describe("userCreateSchema department/work-area bindings", () => {
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const deptUuid = "9a5c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b06";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("ho may carry departmentId alongside siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: siteUuid,
      departmentId: deptUuid,
    });
    expect(result.success).toBe(true);
  });

  test("ho never carries workAreaId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: siteUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(false);
  });

  test("admin may carry both departmentId and workAreaId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "admin",
      siteLocationId: locUuid,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(true);
  });

  test("admin without the required siteLocationId still fails even with department bindings", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "admin",
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(false);
  });

  test("superadmin carries neither departmentId nor workAreaId", () => {
    const withDept = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough1",
      role: "superadmin",
      departmentId: deptUuid,
    });
    expect(withDept.success).toBe(false);
    const withWa = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough1",
      role: "superadmin",
      workAreaId: waUuid,
    });
    expect(withWa.success).toBe(false);
  });

  test("a non-uuid departmentId is rejected", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: siteUuid,
      departmentId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("userUpdateSchema department/work-area bindings", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const deptUuid = "9a5c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b06";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("ho edit with siteId and departmentId parses", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "HO",
      role: "ho",
      siteId: siteUuid,
      departmentId: deptUuid,
    });
    expect(result.success).toBe(true);
  });

  test("ho edit with workAreaId is rejected", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "HO",
      role: "ho",
      siteId: siteUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(false);
  });

  test("admin edit may carry departmentId and workAreaId", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "Site Admin",
      role: "admin",
      siteLocationId: locUuid,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(true);
  });

  test("superadmin edit with departmentId is rejected", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "Root",
      role: "superadmin",
      departmentId: deptUuid,
    });
    expect(result.success).toBe(false);
  });
});

describe("parseUserCreate department/work-area stripping", () => {
  const base = {
    name: "Site Admin",
    email: "site@shiftly.test",
    password: "longenough1",
  };
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const deptUuid = "9a5c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b06";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("ho keeps siteId and departmentId, strips workAreaId (null siteLocationId too)", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "ho",
      siteId: siteUuid,
      siteLocationId: null,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBe(siteUuid);
      expect(parsed.data.departmentId).toBe(deptUuid);
      expect(parsed.data.siteLocationId).toBeUndefined();
      expect(parsed.data.workAreaId).toBeUndefined();
    }
  });

  test("admin keeps siteLocationId, departmentId and workAreaId, strips siteId", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "admin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteLocationId).toBe(locUuid);
      expect(parsed.data.departmentId).toBe(deptUuid);
      expect(parsed.data.workAreaId).toBe(waUuid);
      expect(parsed.data.siteId).toBeUndefined();
    }
  });

  test("superadmin gets all four bindings stripped", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "superadmin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBeUndefined();
      expect(parsed.data.siteLocationId).toBeUndefined();
      expect(parsed.data.departmentId).toBeUndefined();
      expect(parsed.data.workAreaId).toBeUndefined();
    }
  });
});

describe("parseUserUpdate department/work-area stripping", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const deptUuid = "9a5c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b06";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("ho keeps siteId and departmentId, strips workAreaId", () => {
    const parsed = parseUserUpdate(id, {
      name: "HO",
      role: "ho",
      siteId: siteUuid,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBe(siteUuid);
      expect(parsed.data.departmentId).toBe(deptUuid);
      expect(parsed.data.workAreaId).toBeUndefined();
    }
  });

  test("admin keeps siteLocationId, departmentId and workAreaId, strips siteId", () => {
    const parsed = parseUserUpdate(id, {
      name: "Site Admin",
      role: "admin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteLocationId).toBe(locUuid);
      expect(parsed.data.departmentId).toBe(deptUuid);
      expect(parsed.data.workAreaId).toBe(waUuid);
      expect(parsed.data.siteId).toBeUndefined();
    }
  });

  test("superadmin gets all four bindings stripped", () => {
    const parsed = parseUserUpdate(id, {
      name: "Root",
      role: "superadmin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      departmentId: deptUuid,
      workAreaId: waUuid,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBeUndefined();
      expect(parsed.data.siteLocationId).toBeUndefined();
      expect(parsed.data.departmentId).toBeUndefined();
      expect(parsed.data.workAreaId).toBeUndefined();
    }
  });
});
