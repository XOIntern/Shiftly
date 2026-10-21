import { describe, expect, test } from "bun:test";
import {
  workerCreateSchema,
  workAreaCreateSchema,
  workAreaUpdateSchema,
  positionCreateSchema,
  positionUpdateSchema,
  userCreateSchema,
  userPasswordSchema,
  changePasswordSchema,
  parseUserCreate,
  parseUserUpdate,
  userUpdateSchema,
  locationCreateSchema,
  locationUpdateSchema,
} from "./validators";
import { fieldErrorsFrom } from "../lib/action-state";

// Same message string as the validators' z.string().min(15, ...) below
// (GitHub #121): assert it through fieldErrorsFrom so the action-facing
// fieldErrors shape carries the exact text.
const PASSWORD_MIN_MESSAGE = "Password must be at least 15 characters";

describe("workAreaCreateSchema", () => {
  test("accepts valid input with a siteId and no departmentId", () => {
    const result = workAreaCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
      name: "Line 1",
    });
    expect(result.success).toBe(true);
  });

  test("strips a stray departmentId from the payload", () => {
    const result = workAreaCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
      departmentId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
      name: "Line 1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("departmentId");
    }
  });

  test("rejects a missing siteLocationId", () => {
    const result = workAreaCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Line 1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid siteLocationId", () => {
    const result = workAreaCreateSchema.safeParse({
      siteLocationId: "nope",
      name: "Line 1",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = workAreaCreateSchema.safeParse({
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("workAreaUpdateSchema", () => {
  const base = {
    id: "8e4c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b05",
    siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    name: "Line 1",
    isActive: true,
  };

  test("accepts a valid update", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an update with only id, siteLocationId, name, isActive", () => {
    const result = workAreaUpdateSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test("rejects a missing isActive", () => {
    const result = workAreaUpdateSchema.safeParse({
      id: base.id,
      siteLocationId: base.siteLocationId,
      name: base.name,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a missing siteLocationId", () => {
    const result = workAreaUpdateSchema.safeParse({
      id: base.id,
      name: base.name,
      isActive: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = workAreaUpdateSchema.safeParse({
      ...base,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("positionCreateSchema", () => {
  test("accepts valid input with a siteId", () => {
    const result = positionCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Operator",
    });
    expect(result.success).toBe(true);
  });

  test("accepts input without a siteId (ho/admin paths derive it server-side)", () => {
    const result = positionCreateSchema.safeParse({ name: "Operator" });
    expect(result.success).toBe(true);
  });

  test("strips a stray siteLocationId from the payload", () => {
    const result = positionCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
      name: "Operator",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("siteLocationId");
    }
  });

  test("rejects a non-uuid siteId", () => {
    const result = positionCreateSchema.safeParse({
      siteId: "nope",
      name: "Operator",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = positionCreateSchema.safeParse({
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("positionUpdateSchema", () => {
  const base = {
    id: "8e4c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b05",
    name: "Operator",
    isActive: true,
  };

  test("accepts a valid update", () => {
    const result = positionUpdateSchema.safeParse({
      ...base,
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an update with only id, name, isActive", () => {
    const result = positionUpdateSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  test("rejects a missing isActive", () => {
    const result = positionUpdateSchema.safeParse({
      id: base.id,
      name: base.name,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid id", () => {
    const result = positionUpdateSchema.safeParse({
      ...base,
      id: "not-a-uuid",
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
    const result = locationUpdateSchema.safeParse({
      ...base,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("userCreateSchema", () => {
  test("accepts a superadmin user without bindings", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough-password",
      role: "superadmin",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an ho user with siteId and no siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough-password",
      role: "ho",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    });
    expect(result.success).toBe(true);
  });

  test("accepts an admin user with siteLocationId and no siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough-password",
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

  test("accepts a password of exactly 15 characters", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "123456789012345",
      role: "superadmin",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a 14-char password with the minimum message", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "12345678901234",
      role: "superadmin",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).password).toBe(PASSWORD_MIN_MESSAGE);
    }
  });

  test("rejects a 201-char password (max 200)", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "x".repeat(201),
      role: "superadmin",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).password).toBe(
        "Too big: expected string to have <=200 characters",
      );
    }
  });

  test("accepts a password of exactly 200 characters (max boundary)", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "x".repeat(200),
      role: "superadmin",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an invalid email", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "not-an-email",
      password: "longenough-password",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unknown role", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough-password",
      role: "worker",
    });
    expect(result.success).toBe(false);
  });

  test("rejects superadmin with a siteId binding", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough-password",
      role: "superadmin",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    });
    expect(result.success).toBe(false);
  });

  test("rejects superadmin with a siteLocationId binding", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough-password",
      role: "superadmin",
      siteLocationId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ho without siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough-password",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ho with siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough-password",
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
      password: "longenough-password",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  test("rejects admin with siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough-password",
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
      password: "longenough-password",
      role: "admin",
      siteLocationId: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("userPasswordSchema", () => {
  test("accepts an exactly-15-char newPassword", () => {
    const result = userPasswordSchema.safeParse({ newPassword: "123456789012345" });
    expect(result.success).toBe(true);
  });

  test("rejects a 14-char newPassword with the minimum message", () => {
    const result = userPasswordSchema.safeParse({ newPassword: "12345678901234" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).newPassword).toBe(PASSWORD_MIN_MESSAGE);
    }
  });

  test("rejects a 201-char newPassword (max 200)", () => {
    const result = userPasswordSchema.safeParse({ newPassword: "x".repeat(201) });
    expect(result.success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  test("accepts a current and an exactly-15-char new password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "old-pass",
      newPassword: "123456789012345",
    });
    expect(result.success).toBe(true);
  });

  test("accepts a new password different from the current one", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "old-pass",
      newPassword: "different-pass-15",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a 14-char newPassword with the minimum message", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "old-pass",
      newPassword: "12345678901234",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).newPassword).toBe(PASSWORD_MIN_MESSAGE);
    }
  });

  test("rejects a 201-char newPassword (max 200)", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "old-pass",
      newPassword: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unchanged-password change", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "same-password-1500",
      newPassword: "same-password-1500",
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
      newPassword: "123456789012345",
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
    if (result.success)
      expect(result.data.siteId).toBe("6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02");
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
    const result = userUpdateSchema.safeParse({
      id,
      name: "Site Admin",
      role: "admin",
    });
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
    if (parsed.success)
      expect(parsed.data.siteId).toBe("6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02");
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
      expect(parsed.data.siteLocationId).toBe(
        "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
      );
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
    password: "longenough-password",
  };
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";

  test("admin with a null siteLocationId fails per-field on siteLocationId", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "admin",
      siteLocationId: null,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.map((issue) => issue.path.join(".")),
      ).toContain("siteLocationId");
    }
  });

  test("admin without a siteLocationId still fails the refine", () => {
    const parsed = parseUserCreate({ ...base, role: "admin" });
    expect(parsed.success).toBe(false);
  });

  test("admin with a siteLocationId parses with siteId stripped", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "admin",
      siteLocationId: locUuid,
    });
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
      password: "longenough-password",
      role: "ho",
      siteId: null,
      siteLocationId: null,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.map((issue) => issue.path.join(".")),
      ).toContain("siteId");
    }
  });

  test("ho creation with a supplied siteId parses, siteLocationId stripped", () => {
    const parsed = parseUserCreate({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough-password",
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
      password: "longenough-password",
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
      password: "longenough-password",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("create schema itself is unchanged: admin with a siteId still rejected", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough-password",
      role: "admin",
      siteId: siteUuid,
      siteLocationId: locUuid,
    });
    expect(result.success).toBe(false);
  });
});

describe("userCreateSchema with the work-area binding removed", () => {
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("a stray workAreaId is stripped, not judged, for an ho create", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough-password",
      role: "ho",
      siteId: siteUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("workAreaId" in result.data).toBe(false);
    }
  });

  test("a stray workAreaId is stripped for an admin create", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough-password",
      role: "admin",
      siteLocationId: locUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("workAreaId" in result.data).toBe(false);
    }
  });

  test("admin without the required siteLocationId still fails", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough-password",
      role: "admin",
      workAreaId: waUuid,
    });
    expect(result.success).toBe(false);
  });

  test("a stray workAreaId is stripped for a superadmin create", () => {
    const result = userCreateSchema.safeParse({
      name: "Root",
      email: "root@shiftly.test",
      password: "longenough-password",
      role: "superadmin",
      workAreaId: waUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("workAreaId" in result.data).toBe(false);
      expect("siteId" in result.data).toBe(false);
      expect("siteLocationId" in result.data).toBe(false);
    }
  });
});

describe("userUpdateSchema with the work-area binding removed", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("an ho edit's stray workAreaId is stripped", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "HO",
      role: "ho",
      siteId: siteUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("workAreaId" in result.data).toBe(false);
    }
  });

  test("an admin edit's stray workAreaId is stripped", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "Site Admin",
      role: "admin",
      siteLocationId: locUuid,
      workAreaId: waUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("workAreaId" in result.data).toBe(false);
    }
  });
});

describe("parseUserCreate work-area stripping", () => {
  const base = {
    name: "Site Admin",
    email: "site@shiftly.test",
    password: "longenough-password",
  };
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("ho keeps siteId; a stray workAreaId never lands in the data", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "ho",
      siteId: siteUuid,
      siteLocationId: null,
      workAreaId: waUuid,
    } as Parameters<typeof parseUserCreate>[0]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBe(siteUuid);
      expect(parsed.data.siteLocationId).toBeUndefined();
      expect("workAreaId" in parsed.data).toBe(false);
    }
  });

  test("admin keeps siteLocationId, strips siteId and workAreaId", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "admin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      workAreaId: waUuid,
    } as Parameters<typeof parseUserCreate>[0]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteLocationId).toBe(locUuid);
      expect(parsed.data.siteId).toBeUndefined();
      expect("workAreaId" in parsed.data).toBe(false);
    }
  });

  test("superadmin gets every binding stripped", () => {
    const parsed = parseUserCreate({
      ...base,
      role: "superadmin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      workAreaId: waUuid,
    } as Parameters<typeof parseUserCreate>[0]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBeUndefined();
      expect(parsed.data.siteLocationId).toBeUndefined();
      expect("workAreaId" in parsed.data).toBe(false);
    }
  });
});

describe("parseUserUpdate work-area stripping", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";
  const locUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const waUuid = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";

  test("ho keeps siteId; a stray workAreaId never lands in the data", () => {
    const parsed = parseUserUpdate(id, {
      name: "HO",
      role: "ho",
      siteId: siteUuid,
      workAreaId: waUuid,
    } as Parameters<typeof parseUserUpdate>[1]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBe(siteUuid);
      expect("workAreaId" in parsed.data).toBe(false);
    }
  });

  test("admin keeps siteLocationId, strips siteId and workAreaId", () => {
    const parsed = parseUserUpdate(id, {
      name: "Site Admin",
      role: "admin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      workAreaId: waUuid,
    } as Parameters<typeof parseUserUpdate>[1]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteLocationId).toBe(locUuid);
      expect(parsed.data.siteId).toBeUndefined();
      expect("workAreaId" in parsed.data).toBe(false);
    }
  });

  test("superadmin gets every binding stripped", () => {
    const parsed = parseUserUpdate(id, {
      name: "Root",
      role: "superadmin",
      siteId: siteUuid,
      siteLocationId: locUuid,
      workAreaId: waUuid,
    } as Parameters<typeof parseUserUpdate>[1]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.siteId).toBeUndefined();
      expect(parsed.data.siteLocationId).toBeUndefined();
      expect("workAreaId" in parsed.data).toBe(false);
    }
  });
});

describe("workerCreateSchema positionIds", () => {
  const locationUuid = "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04";
  const positionA = "2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07";
  const positionB = "3a6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b08";
  const base = {
    siteLocationId: locationUuid,
    employeeId: "EMP-1",
    name: "Worker One",
    // Required since issue #119 — the positionIds block tests the position
    // set, so it always parses with a valid date.
    contractEndDate: "2027-12-31",
  };

  test("accepts two distinct uuid positions", () => {
    const result = workerCreateSchema.safeParse({
      ...base,
      positionIds: [positionA, positionB],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.positionIds).toEqual([positionA, positionB]);
    }
  });

  test("rejects an empty array with a positionIds message", () => {
    const result = workerCreateSchema.safeParse({ ...base, positionIds: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join(".")).toBe("positionIds");
      expect(result.error.issues[0].message.length).toBeGreaterThan(0);
    }
  });

  test("rejects duplicate ids with 'Select each position once'", () => {
    const result = workerCreateSchema.safeParse({
      ...base,
      positionIds: [positionA, positionA],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join(".")).toBe("positionIds");
      expect(result.error.issues[0].message).toBe("Select each position once");
    }
  });
});

describe("workerCreateSchema contractEndDate", () => {
  const base = {
    siteLocationId: "7d3c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b04",
    positionIds: ["2f6c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b07"],
    employeeId: "EMP-1",
    name: "Worker One",
  };

  test("refuses a missing date with 'Contract end is required'", () => {
    const result = workerCreateSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join(".")).toBe("contractEndDate");
      expect(result.error.issues[0].message).toBe("Contract end is required");
    }
  });

  test("refuses an empty date with 'Contract end is required'", () => {
    const result = workerCreateSchema.safeParse({
      ...base,
      contractEndDate: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join(".")).toBe("contractEndDate");
      expect(result.error.issues[0].message).toBe("Contract end is required");
    }
  });

  test("refuses a malformed date with 'Contract end must be a valid date'", () => {
    const result = workerCreateSchema.safeParse({
      ...base,
      contractEndDate: "31-12-2027",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.join(".")).toBe("contractEndDate");
      expect(result.error.issues[0].message).toBe(
        "Contract end must be a valid date",
      );
    }
  });

  test("accepts a valid date", () => {
    const result = workerCreateSchema.safeParse({
      ...base,
      contractEndDate: "2027-12-31",
    });
    expect(result.success).toBe(true);
  });
});
