import { Badge } from "@/components/ui/badge";
import type { MpRequestRow } from "@/types/mp-request";

// Badge faces for the request status (code-derived names).
const STATUS_BADGE: Record<
  MpRequestRow["status"],
  { label: string; variant: "default" | "secondary" | "outline" | "success" | "destructive" }
> = {
  open: { label: "Open", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  fulfilled: { label: "Fulfilled", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
};

export function RequestStatusBadge({ status }: { status: MpRequestRow["status"] }) {
  const face = STATUS_BADGE[status];
  return <Badge variant={face.variant}>{face.label}</Badge>;
}

// A weekly request that was approved or fulfilled has a roster week to open;
// locationId lands superadmin and HO on the request's own location.
export const rosterHrefFor = (request: MpRequestRow): string | null =>
  request.type === "weekly" &&
  (request.status === "approved" || request.status === "fulfilled")
    ? `/dashboard/roster?week=${request.weekStart}&locationId=${request.siteLocationId}`
    : null;

// Client mirror of requestMutability (lib/mp-request-lock): the server action
// stays the authority, this only decides what to offer. A daily request is
// editable while open; a weekly one from entry (approved) until its week has a
// roster plan.
export const isRequestMutable = (request: MpRequestRow): boolean =>
  request.type === "daily"
    ? request.status === "open"
    : request.status === "approved" && !request.rosterLocked;
