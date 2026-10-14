"use server";

import { count, eq } from "drizzle-orm";
import type { ZodError } from "zod";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { client, site } from "@/drizzle/schema";
import { mapDbError } from "@/lib/db-errors";
import { requireHO } from "@/lib/session";
import type { ActionState } from "@/lib/action-state";
import { clientCreateSchema, clientUpdateSchema } from "@/lib/validators";

function fieldErrorsFromZod(error: ZodError<unknown>): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createClient(formState: ActionState, name: string): Promise<ActionState> {
  await requireHO();

  const parsed = clientCreateSchema.safeParse({ name });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  try {
    await db.insert(client).values({ name: parsed.data.name });
  } catch (err) {
    const message = mapDbError(err, { kind: "name" });
    if (!message) throw err;
    return { ok: false, fieldErrors: { name: message } };
  }

  revalidatePath("/clients");
  return { ok: true };
}

export async function renameClient(id: string, name: string): Promise<ActionState> {
  await requireHO();

  const parsed = clientUpdateSchema.safeParse({ id, name });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  try {
    const updated = await db
      .update(client)
      .set({ name: parsed.data.name })
      .where(eq(client.id, parsed.data.id))
      .returning({ id: client.id });

    if (updated.length === 0) {
      return { ok: false, message: "Client not found" };
    }
  } catch (err) {
    const message = mapDbError(err, { kind: "name" });
    if (!message) throw err;
    return { ok: false, fieldErrors: { name: message } };
  }

  revalidatePath("/clients");
  return { ok: true };
}

export async function deleteClient(id: string): Promise<ActionState> {
  await requireHO();

  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, fieldErrors: { id: "Invalid client id" } };
  }

  // The count-check lives here (server-side), not in the UI.
  const [{ siteCount }] = await db
    .select({ siteCount: count() })
    .from(site)
    .where(eq(site.clientId, id));

  if (siteCount > 0) {
    return { ok: false, message: `still has ${siteCount} sites` };
  }

  try {
    await db.delete(client).where(eq(client.id, id));
  } catch (err) {
    // A site can appear between the count-check and the delete; the
    // restrict FK then surfaces as 23503 here.
    const message = mapDbError(err, { kind: "name" });
    if (!message) throw err;
    return { ok: false, message };
  }

  revalidatePath("/clients");
  return { ok: true };
}
