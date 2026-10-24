import { describe, expect, test } from "bun:test";
import {
  changePasswordSchema,
  parseUserCreate,
  parseUserUpdate,
  userCreateSchema,
  userPasswordSchema,
  userUpdateSchema,
} from "./user";

const SITE_ID = "c2d3e4f5-a6b7-4c8d-9e0f-1a2b3c4d5e6f";
const SITE_LOCATION_ID = "d3e4f5a6-b7c8-4d9e-8f0a-2b3c4d5e6f7a";
const USER_ID = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

const PASSWORD_8 = "a".repeat(8);

const baseCreate = {
  name: "User Satu",
  email: "user@example.com",
  password: PASSWORD_8,
  role: "admin",
  siteLocationId: SITE_LOCATION_ID,
};

describe("userCreateSchema role bindings", () => {
  test("accepts a superadmin without any binding", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      role: "superadmin",
      siteLocationId: undefined,
    });
    expect(result.success).toBe(true);
  });

  test("rejects a superadmin carrying a siteId, landing the issue at the root", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      role: "superadmin",
      siteLocationId: undefined,
      siteId: SITE_ID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual([]);
    }
  });

  test("rejects a superadmin carrying a siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      role: "superadmin",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([]);
    }
  });

  test("accepts an ho bound to a site only", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      role: "ho",
      siteLocationId: undefined,
      siteId: SITE_ID,
    });
    expect(result.success).toBe(true);
  });

  test("rejects an ho carrying a siteLocationId", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      role: "ho",
      siteId: SITE_ID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([]);
    }
  });

  test("rejects an ho without any binding", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      role: "ho",
      siteLocationId: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([]);
    }
  });

  test("accepts an admin bound to a site_location only", () => {
    const result = userCreateSchema.safeParse(baseCreate);
    expect(result.success).toBe(true);
  });

  test("rejects an admin carrying a siteId", () => {
    const result = userCreateSchema.safeParse({ ...baseCreate, siteId: SITE_ID });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([]);
    }
  });

  test("rejects an admin without any binding", () => {
    const result = userCreateSchema.safeParse({ ...baseCreate, siteLocationId: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([]);
    }
  });
});

describe("userCreateSchema field checks", () => {
  test("rejects an unknown role on the role field", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      role: "manager" as never,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("role"))).toBe(true);
    }
  });

  test("rejects a non-email address on the email field", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("email"))).toBe(true);
    }
  });

  test("rejects a create password under 8 characters", () => {
    const result = userCreateSchema.safeParse({
      ...baseCreate,
      password: "a".repeat(7),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("password"))).toBe(true);
    }
  });

  test("accepts a create password of exactly 8 characters", () => {
    const result = userCreateSchema.safeParse(baseCreate);
    expect(result.success).toBe(true);
  });

  test("rejects a whitespace-only name", () => {
    const result = userCreateSchema.safeParse({ ...baseCreate, name: "   " });
    expect(result.success).toBe(false);
  });

  test("trims surrounding whitespace from the name", () => {
    const result = userCreateSchema.safeParse({ ...baseCreate, name: "  User Satu  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("User Satu");
    }
  });
});

describe("parseUserCreate", () => {
  test("drops a smuggled siteLocationId from an ho and keeps the siteId", () => {
    const result = parseUserCreate({
      ...baseCreate,
      role: "ho",
      siteLocationId: SITE_LOCATION_ID,
      siteId: SITE_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.siteId).toBe(SITE_ID);
      expect("siteLocationId" in result.data).toBe(false);
    }
  });

  test("drops a smuggled siteId from an admin and keeps the siteLocationId", () => {
    const result = parseUserCreate({
      ...baseCreate,
      siteId: SITE_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.siteLocationId).toBe(SITE_LOCATION_ID);
      expect("siteId" in result.data).toBe(false);
    }
  });

  test("strips both bindings from a superadmin", () => {
    const result = parseUserCreate({
      ...baseCreate,
      role: "superadmin",
      siteLocationId: SITE_LOCATION_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("siteId" in result.data).toBe(false);
      expect("siteLocationId" in result.data).toBe(false);
    }
  });

  test("fails an ho whose siteId binding is null on the siteId field", () => {
    const result = parseUserCreate({
      ...baseCreate,
      role: "ho",
      siteLocationId: null,
      siteId: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("siteId"))).toBe(true);
    }
  });
});

describe("userPasswordSchema (superadmin reset)", () => {
  test("accepts the 8..100 character boundaries", () => {
    expect(userPasswordSchema.safeParse({ newPassword: "a".repeat(8) }).success).toBe(true);
    expect(userPasswordSchema.safeParse({ newPassword: "a".repeat(100) }).success).toBe(true);
  });

  test("rejects a 7-character and an over-100-character password", () => {
    expect(userPasswordSchema.safeParse({ newPassword: "a".repeat(7) }).success).toBe(false);
    expect(userPasswordSchema.safeParse({ newPassword: "a".repeat(101) }).success).toBe(false);
  });

  test("the short-password message matches the enforced minimum", () => {
    const result = userPasswordSchema.safeParse({ newPassword: "a".repeat(7) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["newPassword"]);
      expect(result.error.issues[0].message).toContain("8 characters");
    }
  });
});

describe("changePasswordSchema", () => {
  test("accepts a new password different from the current one", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "current-secret",
      newPassword: "a".repeat(8),
    });
    expect(result.success).toBe(true);
  });

  test("rejects a new password equal to the current one, on the newPassword field", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "a".repeat(8),
      newPassword: "a".repeat(8),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual(["newPassword"]);
    }
  });

  test("rejects an empty current password", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "",
      newPassword: "a".repeat(8),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("currentPassword"))).toBe(true);
    }
  });

  test("the short-password message matches the enforced minimum", () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: "current-secret",
      newPassword: "a".repeat(7),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["newPassword"]);
      expect(result.error.issues[0].message).toContain("8 characters");
    }
  });
});

describe("parseUserUpdate", () => {
  test("strips both bindings from a superadmin", () => {
    const result = parseUserUpdate(USER_ID, {
      name: "User Satu",
      role: "superadmin",
      siteLocationId: SITE_LOCATION_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("siteId" in result.data).toBe(false);
      expect("siteLocationId" in result.data).toBe(false);
    }
  });

  test("keeps only the siteId for an ho", () => {
    const result = parseUserUpdate(USER_ID, {
      name: "User Satu",
      role: "ho",
      siteLocationId: SITE_LOCATION_ID,
      siteId: SITE_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.siteId).toBe(SITE_ID);
      expect("siteLocationId" in result.data).toBe(false);
    }
  });

  test("keeps only the siteLocationId for an admin", () => {
    const result = parseUserUpdate(USER_ID, {
      name: "User Satu",
      role: "admin",
      siteId: SITE_ID,
      siteLocationId: SITE_LOCATION_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.siteLocationId).toBe(SITE_LOCATION_ID);
      expect("siteId" in result.data).toBe(false);
    }
  });

  test("rejects an empty id on the id field", () => {
    const result = parseUserUpdate("", {
      name: "User Satu",
      role: "admin",
      siteLocationId: SITE_LOCATION_ID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("id"))).toBe(true);
    }
  });

  test("omits email and password from the update payload", () => {
    const result = userUpdateSchema.safeParse({
      id: USER_ID,
      name: "User Satu",
      role: "admin",
      siteLocationId: SITE_LOCATION_ID,
      email: "changed@example.com",
      password: PASSWORD_8,
    } as never);
    expect(result.success).toBe(true);
    if (result.success) {
      expect("email" in result.data).toBe(false);
      expect("password" in result.data).toBe(false);
    }
  });
});
