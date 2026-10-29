import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { auditLog } from "../drizzle/schema";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// The audit rows a viewer may read: superadmin unbounded (undefined, no
// filter), an ho the rows of their own site. An admin never reads the trail,
// and an ho without a site binding matches nothing rather than everything.
// audit_log.site_id is nullable, so a row without a site is the superadmin's
// alone: `site_id = <site>` never matches null.
export function auditLogListWhere(actor: ScopedActor): SQL | undefined {
  if (actor.role === "superadmin") return undefined;
  if (actor.role === "ho" && actor.siteId) {
    return eq(auditLog.siteId, actor.siteId);
  }
  return sql`false`;
}
