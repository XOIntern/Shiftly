"use client";

import { StatusFilter } from "@/components/status-filter";

// The sites page's status filter: the shared one plus the soft-deleted list.
// Both site tables render it so either list can switch to the other.
export function SiteStatusFilter() {
  return (
    <StatusFilter extraOptions={[{ value: "deleted", label: "Deleted" }]} />
  );
}
