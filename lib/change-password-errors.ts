import type { ActionState } from "@/types/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";

// Maps a Better Auth rejection to the action result shape. Lives outside the
// "use server" module: Next requires every export there to be async, and this
// stays a synchronous pure mapping (pinned by lib/change-password.test.ts).
export function changePasswordErrorState(err: unknown): ActionState {
  const code =
    typeof err === "object" && err !== null && "body" in err
      ? (err as { body?: { code?: string } }).body?.code
      : undefined;
  if (code === "INVALID_PASSWORD") {
    return {
      ok: false,
      fieldErrors: { currentPassword: "Current password is incorrect." },
    };
  }
  return { ok: false, message: GENERIC_ERROR };
}
