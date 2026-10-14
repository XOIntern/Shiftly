import { eq } from "drizzle-orm";

import { siteLocation } from "../drizzle/schema";
import { db } from "./db";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer.
type ScopedActor = { role: "superadmin" | "ho" | "admin"; siteId: string | null };

// Data-level scoping for by-id location mutations (docs/architecture.md
// §7.2): a ho may only touch locations under their own binding's site, so a
// direct call against another site's row must fail closed. superadmin is
// unbound and keeps full capability — owning nothing, owning everything.
//
// Reads the row's site rather than adding siteId to the mutating WHERE, so
// callers can reject with "Location not found." before any writes happen
// (mirrors users/actions.ts loadManagedTarget). An unbound ho (siteId null)
// can never match, since site_location.site_id is NOT NULL.
export async function locationOwnedByActor(
  actor: ScopedActor,
  id: string,
): Promise<boolean> {
  if (actor.role === "superadmin") return true;

  const [row] = await db
    .select({ siteId: siteLocation.siteId })
    .from(siteLocation)
    .where(eq(siteLocation.id, id))
    .limit(1);

  return !!row && row.siteId === actor.siteId;
}
