import { and, eq, inArray } from "drizzle-orm";

import { rosterPlan } from "@/drizzle/schema";
import { db } from "@/lib/db";
import type { MpRequestRow } from "@/types/mp-request";

// mutable: the requester may still edit or withdraw it. closed: its status
// already ended that. rostered: an approved weekly whose week has a roster
// plan, so changing it would pull the rug from under the roster.
export type RequestMutability = "mutable" | "closed" | "rostered";

export function weekKey(siteLocationId: string, weekStart: string): string {
  return `${siteLocationId}|${weekStart}`;
}

// A draft plan locks the week too, not only a published one: the engine has
// already consumed the request's lines by then.
export async function requestMutability(
  executor: Pick<typeof db, "select">,
  row: {
    type: "weekly" | "daily";
    status: MpRequestRow["status"];
    siteLocationId: string;
    weekStart: string | null;
  },
): Promise<RequestMutability> {
  if (row.type === "daily") return row.status === "open" ? "mutable" : "closed";
  if (row.status !== "approved" || !row.weekStart) return "closed";

  const [plan] = await executor
    .select({ id: rosterPlan.id })
    .from(rosterPlan)
    .where(
      and(
        eq(rosterPlan.kind, "weekly"),
        eq(rosterPlan.siteLocationId, row.siteLocationId),
        eq(rosterPlan.weekStart, row.weekStart),
      ),
    )
    .limit(1);
  return plan ? "rostered" : "mutable";
}

// One query for a whole list page. The two inArray filters form a cross
// product, so rows are re-checked against the exact pairs that were asked for.
export async function rosterLockedWeeks(
  pairs: { siteLocationId: string; weekStart: string }[],
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();

  const wanted = new Set(
    pairs.map((p) => weekKey(p.siteLocationId, p.weekStart)),
  );
  const rows = await db
    .select({
      siteLocationId: rosterPlan.siteLocationId,
      weekStart: rosterPlan.weekStart,
    })
    .from(rosterPlan)
    .where(
      and(
        eq(rosterPlan.kind, "weekly"),
        inArray(rosterPlan.weekStart, [
          ...new Set(pairs.map((p) => p.weekStart)),
        ]),
        inArray(rosterPlan.siteLocationId, [
          ...new Set(pairs.map((p) => p.siteLocationId)),
        ]),
      ),
    );

  const locked = new Set<string>();
  for (const r of rows) {
    if (!r.weekStart) continue;
    const key = weekKey(r.siteLocationId, r.weekStart);
    if (wanted.has(key)) locked.add(key);
  }
  return locked;
}
