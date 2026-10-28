import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { seedAdmin } from "./seed-admin";
import { auth } from "../lib/auth";
import { db } from "../lib/db";
import { user } from "../drizzle/schema";

const TEST_ENV = {
  email: "seed-admin-test@shiftly.test",
  password: "test-password-123",
};

async function cleanup() {
  await db.delete(user).where(eq(user.email, TEST_ENV.email));
}

// Runs after every test, passed or failed, so no test leaves the seeded user
// (and its credential account, which cascades) behind for the next one.
afterEach(cleanup);

describe("seedAdmin", () => {
  test("fails fast when ADMIN_EMAIL is missing", async () => {
    const result = await seedAdmin({ email: "", password: TEST_ENV.password });
    expect(result).toBe("error-missing-env");
  });

  test("fails fast when ADMIN_PASSWORD is too short", async () => {
    const result = await seedAdmin({ email: TEST_ENV.email, password: "abc" });
    expect(result).toBe("error-weak-password");
  });

  test("rejects a 14-character password at the 15-char minimum boundary", async () => {
    const result = await seedAdmin({
      email: TEST_ENV.email,
      password: "1234567890abcd", // 14 chars
    });
    expect(result).toBe("error-weak-password");
  });

  test("creates admin user on first run, verifies login, marks verified", async () => {
    await cleanup();
    const result = await seedAdmin(TEST_ENV);
    expect(result).toBe("created");

    const rows = await db
      .select()
      .from(user)
      .where(eq(user.email, TEST_ENV.email));
    expect(rows.length).toBe(1);
    expect(rows[0].emailVerified).toBe(true);
    expect(rows[0].role).toBe("superadmin");
    expect(rows[0].isActive).toBe(true);

    const login = await auth.api.signInEmail({
      body: { email: TEST_ENV.email, password: TEST_ENV.password },
    });
    expect(login?.token).toBeTruthy();
  });

  test("is idempotent: second run skips", async () => {
    // Its own first run: the test must not rely on the create test having
    // run just before it (bun test --randomize reorders tests in a file).
    await cleanup();
    expect(await seedAdmin(TEST_ENV)).toBe("created");
    const result = await seedAdmin(TEST_ENV);
    expect(result).toBe("exists");
    const rows = await db
      .select()
      .from(user)
      .where(eq(user.email, TEST_ENV.email));
    expect(rows.length).toBe(1);
  });
});
