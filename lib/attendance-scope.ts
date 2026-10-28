import { and, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { siteLocation } from "../drizzle/schema";

// Same shape as SessionUser's scope fields, without pulling next/headers
// (lib/session) into every importer.
type ScopedActor = {
  role: "superadmin" | "ho" | "admin";
  siteId: string | null;
  siteLocationId: string | null;
};

// Attendance is written by the Admin of one location and read by everyone
// else: the only location an actor may WRITE to is an admin's own. An ho and a
// superadmin get null, so every write path that starts from this fails closed
// for them whatever the client sends.
export function writableLocationId(actor: ScopedActor): string | null {
  return actor.role === "admin" ? (actor.siteLocationId ?? null) : null;
}

// The live locations the actor may open on the attendance page, the same
// three-way shape as the roster page's picker: superadmin every live location,
// an admin only their own, an ho their site's. A missing binding matches
// nothing rather than everything.
export function attendanceLocationWhere(actor: ScopedActor): SQL {
  const live = isNull(siteLocation.deletedAt);
  if (actor.role === "superadmin") return live;
  if (actor.role === "admin") {
    return actor.siteLocationId
      ? and(live, eq(siteLocation.id, actor.siteLocationId))!
      : sql`false`;
  }
  return actor.siteId
    ? and(live, eq(siteLocation.siteId, actor.siteId))!
    : sql`false`;
}
