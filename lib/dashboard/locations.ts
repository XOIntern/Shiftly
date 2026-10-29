import { asc, eq } from "drizzle-orm";

import { site, siteLocation } from "@/drizzle/schema";
import { attendanceLocationWhere } from "@/lib/attendance-scope";
import { db } from "@/lib/db";
import type { ScopeActor } from "@/types/session";
import type { LocationTimezone } from "@/types/timezone";

export type DashLocation = {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  timezone: LocationTimezone;
};

// The live locations the actor may see on the dashboard: the same scope as the
// attendance and roster pickers (superadmin all, ho their site's, admin their
// own, an unbound actor none), site name first, then location name.
export async function loadScopedLocations(
  actor: ScopeActor,
): Promise<DashLocation[]> {
  return db
    .select({
      id: siteLocation.id,
      siteId: siteLocation.siteId,
      siteName: site.name,
      name: siteLocation.name,
      timezone: siteLocation.timezone,
    })
    .from(siteLocation)
    .innerJoin(site, eq(siteLocation.siteId, site.id))
    .where(attendanceLocationWhere(actor))
    .orderBy(asc(site.name), asc(siteLocation.name));
}
