"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { changePasswordErrorState } from "@/lib/change-password-errors";
import type { ActionState } from "@/types/action-state";
import { fieldErrorsFrom } from "@/lib/action-state";
import { changePasswordSchema } from "@/schema/validators";

// No requireUser() gate here: the endpoint's sensitiveSessionMiddleware
// already rejects unauthenticated calls with UNAUTHORIZED (pinned by the
// contract test), so a second gate would duplicate it.
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ActionState> {
  const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (err) {
    return changePasswordErrorState(err);
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
