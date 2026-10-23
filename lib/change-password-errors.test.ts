import { describe, expect, test } from "bun:test";
import { APIError } from "better-auth/api";

import { changePasswordErrorState } from "./change-password-errors";
import { GENERIC_ERROR } from "./action-state";

// Pins the pure Better Auth rejection → ActionState mapping. Moved here
// from change-password.test.ts so the helper's tests sit next to its
// module; the action's own flow stays pinned by change-password.test.ts.
describe("changePasswordErrorState", () => {
  test("maps INVALID_PASSWORD to a currentPassword field error", () => {
    const err = new APIError("BAD_REQUEST", {
      message: "Invalid password",
      code: "INVALID_PASSWORD",
    });

    const result = changePasswordErrorState(err);

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({
      currentPassword: "Current password is incorrect.",
    });
    expect(result.message).toBeUndefined();
  });

  test("maps an unknown error code to the generic failure", () => {
    const err = new APIError("BAD_REQUEST", {
      message: "no account",
      code: "CREDENTIAL_ACCOUNT_NOT_FOUND",
    });

    const result = changePasswordErrorState(err);

    expect(result).toEqual({ ok: false, message: GENERIC_ERROR });
  });

  test("maps a non-APIError throw to the generic failure", () => {
    const result = changePasswordErrorState(new Error("boom"));

    expect(result).toEqual({ ok: false, message: GENERIC_ERROR });
  });

  test("maps a non-object throw to the generic failure", () => {
    const result = changePasswordErrorState("network down");

    expect(result).toEqual({ ok: false, message: GENERIC_ERROR });
  });
});
