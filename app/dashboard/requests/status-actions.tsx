"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  EllipsisIcon,
  ListIcon,
  Loader2Icon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { MpRequestLineView, MpRequestRow } from "@/types/mp-request";
import { GENERIC_ERROR } from "@/lib/action-state";
import { advanceStatus } from "@/app/dashboard/requests/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Approval is HO/superadmin work on weekly requests that are still open;
// the server action enforces the same rule, this only decides what to offer.
export const canApproveRequest = (
  request: MpRequestRow,
  canApprove: boolean,
): boolean =>
  canApprove && request.type === "weekly" && request.status === "open";

// Only an open request can be edited, and only by roles that write lines.
export const canEditRequest = (
  request: MpRequestRow,
  canWrite: boolean,
): boolean => canWrite && request.status === "open";

const periodLabel = (request: MpRequestRow): string =>
  request.type === "weekly"
    ? `week of ${request.weekStart}`
    : `date ${request.requestDate}`;

export function RowApproval({ request }: { request: MpRequestRow }) {
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"approved" | "rejected" | null>(null);
  const period = periodLabel(request);

  function decide(nextStatus: "approved" | "rejected") {
    setChoice(nextStatus);
    startTransition(async () => {
      const result = await advanceStatus(request.id, nextStatus);
      if (result.ok) {
        toast.success(
          nextStatus === "approved" ? "Request approved." : "Request rejected.",
        );
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        aria-busy={pending && choice === "approved"}
        aria-label={`Approve request for ${period}`}
        onClick={() => decide("approved")}
      >
        {pending && choice === "approved" ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <CheckIcon data-icon="inline-start" />
        )}
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        aria-busy={pending && choice === "rejected"}
        aria-label={`Reject request for ${period}`}
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => decide("rejected")}
      >
        {pending && choice === "rejected" ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <XIcon data-icon="inline-start" />
        )}
        Reject
      </Button>
    </div>
  );
}

export function MpRequestRowActions({
  request,
  canWrite,
  canApprove,
}: {
  request: MpRequestRow;
  // May the actor write request lines? Admin (own location) and superadmin
  // only: an ho carries approval and the view entry alone.
  canWrite: boolean;
  // May the actor approve or reject? HO and superadmin.
  canApprove: boolean;
}) {
  const [dialog, setDialog] = useState<"lines" | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center justify-end gap-2">
      {canApproveRequest(request, canApprove) ? (
        <RowApproval request={request} />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for request ${request.siteName ?? ""} ${request.locationName}`}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setDialog("lines")}>
              <ListIcon />
              View lines
            </DropdownMenuItem>
            {canEditRequest(request, canWrite) ? (
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/dashboard/requests/${request.id}/edit`)
                }
              >
                <PencilIcon />
                Edit lines
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
        {/* Controlled dialogs live outside the menu popup so the menu can
        close before their layer opens. */}
        <Dialog
          open={dialog === "lines"}
          onOpenChange={(open) => setDialog(open ? "lines" : null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request lines</DialogTitle>
              <DialogDescription>
                {request.type === "weekly"
                  ? `Week of ${request.weekStart}`
                  : `Date ${request.requestDate}`}
              </DialogDescription>
            </DialogHeader>
            <RequestLinesTable lines={request.lines} />
          </DialogContent>
        </Dialog>
      </DropdownMenu>
    </div>
  );
}

// The detail dialog's lines table, extracted so the position column (epic
// #135) renders statelessly — the dialog itself mounts closed and never
// reaches the server, but this table can be pinned by SSR tests directly.
export function RequestLinesTable({ lines }: { lines: MpRequestLineView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Work area</TableHead>
          <TableHead>Shift</TableHead>
          <TableHead>Position</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Headcount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line, index) => (
          <TableRow
            key={`${line.workAreaId}|${line.shiftDefinitionId}|${line.positionId}|${index}`}
          >
            <TableCell>{line.workAreaName}</TableCell>
            <TableCell>{line.shiftLabel}</TableCell>
            <TableCell>{line.positionName}</TableCell>
            <TableCell className="tabular-nums">{line.date}</TableCell>
            <TableCell className="text-right tabular-nums">
              {line.headcount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
