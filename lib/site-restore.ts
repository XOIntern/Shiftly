import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { site } from "../drizzle/schema";
import { DUPLICATE_MESSAGES } from "../types/db-error";
import { db } from "./db";

// Transaction type produced by drizzle's db.transaction callback, so both
// the live db and a real tx can drive this helper.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RestoreSiteResult = { ok: true } | { ok: false; message: string };

// Brings a soft-deleted site back: only the site row, which stays inactive
// (deleting one demands deactivation first). Its soft-deleted locations,
// work areas, users and the rest were deleted on their own and stay deleted.
// The live-name unique index is the backstop; the pre-check only turns the
// common clash into a plain message instead of an aborted transaction.
//
// Exported for tests, mirroring deleteSiteGuarded and purgeSiteGuarded.
export async function restoreSiteGuarded(
  tx: Tx,
  id: string,
): Promise<RestoreSiteResult> {
  const [row] = await tx
    .select({ name: site.name })
    .from(site)
    .where(and(eq(site.id, id), isNotNull(site.deletedAt)))
    .limit(1)
    .for("update");
  if (!row) return { ok: false, message: "Deleted site not found." };

  const [taken] = await tx
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.name, row.name), isNull(site.deletedAt)))
    .limit(1);
  if (taken) return { ok: false, message: DUPLICATE_MESSAGES["site-name"] };

  await tx.update(site).set({ deletedAt: null }).where(eq(site.id, id));
  return { ok: true };
}
