import { describe, expect, test } from "bun:test";
import {
  clientCreateSchema,
  clientUpdateSchema,
  siteCreateSchema,
  siteUpdateSchema,
  userCreateSchema,
  userPasswordSchema,
  parseUserCreate,
  parseUserUpdate,
  userUpdateSchema,
} from "./validators";

describe("clientCreateSchema", () => {
  test("accepts a valid name", () => {
    expect(clientCreateSchema.safeParse({ name: "Acme Corp" }).success).toBe(true);
  });

  test("rejects an empty name", () => {
    expect(clientCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });

  test("rejects a name over 200 chars", () => {
    expect(clientCreateSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
  });
});

describe("clientUpdateSchema", () => {
  test("accepts a valid id and name", () => {
    const result = clientUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "Acme Corp",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a non-uuid id", () => {
    const result = clientUpdateSchema.safeParse({ id: "not-a-uuid", name: "Acme Corp" });
    expect(result.success).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = clientUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("siteCreateSchema", () => {
  test("accepts valid site input", () => {
    const result = siteCreateSchema.safeParse({
      clientId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "HQ Plant",
      location: "Jakarta",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an empty name", () => {
    const result = siteCreateSchema.safeParse({
      clientId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "",
      location: "Jakarta",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty location", () => {
    const result = siteCreateSchema.safeParse({
      clientId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      name: "HQ Plant",
      location: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a non-uuid clientId", () => {
    const result = siteCreateSchema.safeParse({
      clientId: "nope",
      name: "HQ Plant",
      location: "Jakarta",
    });
    expect(result.success).toBe(false);
  });
});

describe("siteUpdateSchema", () => {
  test("accepts valid site update with isActive", () => {
    const result = siteUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      clientId: "8d2a9e1b-3c7f-4a2b-b1d9-6f5e4a3b2c10",
      name: "HQ Plant",
      location: "Jakarta",
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing isActive", () => {
    const result = siteUpdateSchema.safeParse({
      id: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
      clientId: "8d2a9e1b-3c7f-4a2b-b1d9-6f5e4a3b2c10",
      name: "HQ Plant",
      location: "Jakarta",
    });
    expect(result.success).toBe(false);
  });
});

describe("userCreateSchema", () => {
  test("accepts an ho user without siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Admin",
      email: "admin@shiftly.test",
      password: "longenough1",
      role: "ho",
    });
    expect(result.success).toBe(true);
  });

  test("accepts a site_admin user with siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "site_admin",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a short password", () => {
    const result = userCreateSchema.safeParse({
      name: "Admin",
      email: "admin@shiftly.test",
      password: "abc",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid email", () => {
    const result = userCreateSchema.safeParse({
      name: "Admin",
      email: "not-an-email",
      password: "longenough1",
      role: "ho",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an invalid role", () => {
    const result = userCreateSchema.safeParse({
      name: "Admin",
      email: "admin@shiftly.test",
      password: "longenough1",
      role: "superuser",
    });
    expect(result.success).toBe(false);
  });

  test("rejects site_admin without siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "site_admin",
    });
    expect(result.success).toBe(false);
  });

  test("rejects site_admin with empty string siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Site Admin",
      email: "site@shiftly.test",
      password: "longenough1",
      role: "site_admin",
      siteId: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects ho with siteId", () => {
    const result = userCreateSchema.safeParse({
      name: "Admin",
      email: "admin@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01",
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

describe("userUpdateSchema", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

  test("does not require an email", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "Site Admin",
      role: "site_admin",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(true);
  });

  test("parses an ho edit without a siteId", () => {
    const result = userUpdateSchema.safeParse({ id, name: "HO", role: "ho" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.siteId).toBeUndefined();
  });

  test("still rejects ho with a siteId (create refine invariant)", () => {
    const result = userUpdateSchema.safeParse({
      id,
      name: "HO",
      role: "ho",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(result.success).toBe(false);
  });

  test("rejects site_admin without a siteId", () => {
    const result = userUpdateSchema.safeParse({ id, name: "SA", role: "site_admin" });
    expect(result.success).toBe(false);
  });
});

describe("parseUserUpdate", () => {
  const id = "5b1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b01";

  test("strips a stale siteId when the role is ho", () => {
    const parsed = parseUserUpdate(id, {
      name: "Admin",
      role: "ho",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.siteId).toBeUndefined();
  });

  test("keeps the siteId when the role is site_admin", () => {
    const parsed = parseUserUpdate(id, {
      name: "Site Admin",
      role: "site_admin",
      siteId: "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.siteId).toBe("6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02");
  });

  test("rejects an unknown role", () => {
    const parsed = parseUserUpdate(id, { name: "X", role: "worker" });
    expect(parsed.success).toBe(false);
  });

  test("rejects site_admin without a siteId (does not strip)", () => {
    const parsed = parseUserUpdate(id, { name: "X", role: "site_admin" });
    expect(parsed.success).toBe(false);
  });
});

describe("parseUserCreate", () => {
  const base = {
    name: "Admin",
    email: "admin@shiftly.test",
    password: "longenough1",
    role: "ho",
  };
  const siteUuid = "6c1c7f9c-20a8-4f4a-9c3f-1ac3ec4d5b02";

  test("normalizes a ho creation with a null siteId (strips the key)", () => {
    const parsed = parseUserCreate({ ...base, siteId: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.siteId).toBeUndefined();
  });

  test("normalizes a ho creation with a supplied siteId (strips the key)", () => {
    const parsed = parseUserCreate({ ...base, siteId: siteUuid });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.siteId).toBeUndefined();
  });

  test("site_admin with a null siteId fails per-field on siteId", () => {
    const parsed = parseUserCreate({ ...base, role: "site_admin", siteId: null });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("siteId");
    }
  });

  test("site_admin without a siteId still fails the refine", () => {
    const parsed = parseUserCreate({ ...base, role: "site_admin" });
    expect(parsed.success).toBe(false);
  });

  test("site_admin with a siteId parses", () => {
    const parsed = parseUserCreate({ ...base, role: "site_admin", siteId: siteUuid });
    expect(parsed.success).toBe(true);
  });

  test("create schema itself is unchanged: ho with a siteId still rejected", () => {
    const result = userCreateSchema.safeParse({
      name: "HO",
      email: "ho@shiftly.test",
      password: "longenough1",
      role: "ho",
      siteId: siteUuid,
    });
    expect(result.success).toBe(false);
  });
});
