import { sql } from "drizzle-orm";

import type { db } from "./db";

type RosterTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Serialises the roster writes of one location for the rest of the caller's
// transaction (released on commit or rollback). A daily fill and a weekly
// publish each validate against the other's rows, so without a shared lock
// both can pass and both commit. Take it FIRST and validate after, so the
// read sees whatever the previous holder committed. The key is namespaced so
// it cannot collide with another advisory-lock user.
export async function lockRosterLocation(
  tx: RosterTx,
  siteLocationId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`roster:${siteLocationId}`}, 0))`,
  );
}
