"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightIcon,
  CheckIcon,
  EllipsisIcon,
  ListIcon,
  PencilIcon,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

// Manual status machine (mirror of the actions' LEGAL_TRANSITIONS — the
// two MUST stay in step): the menu renders ONLY these next statuses, so a
// terminal request shows no advance items at all.
type AdvanceItem = {
  status: "approved" | "fulfilled" | "rejected";
  label: string;
};

const NEXT_STATUSES: Record<MpRequestRow["status"], AdvanceItem[]> = {
  open: [
    { status: "approved", label: "Approve" },
    { status: "rejected", label: "Reject" },
  ],
  approved: [
    { status: "fulfilled", label: "Mark fulfilled" },
    { status: "rejected", label: "Reject" },
  ],
  fulfilled: [],
  rejected: [],
};

function AdvanceMenu({ request }: { request: MpRequestRow }) {
  const [pending, startTransition] = useTransition();

  function advance(nextStatus: "approved" | "fulfilled" | "rejected") {
    startTransition(async () => {
      const result = await advanceStatus(request.id, nextStatus);
      if (result.ok) {
        toast.success(
          nextStatus === "approved"
            ? "Request approved."
            : nextStatus === "fulfilled"
              ? "Request fulfilled."
              : "Request rejected.",
        );
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  const items = NEXT_STATUSES[request.status];

  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.status}
          disabled={pending}
          variant={item.status === "rejected" ? "destructive" : undefined}
          onClick={() => advance(item.status)}
        >
          {item.status === "rejected" ? <ArrowRightIcon /> : <CheckIcon />}
          {item.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function MpRequestRowActions({
  request,
  canWrite,
}: {
  request: MpRequestRow;
  // May the actor write request lines? Admin (own location) and superadmin
  // only — an ho carries the view + status menu alone.
  canWrite: boolean;
}) {
  const [dialog, setDialog] = useState<"lines" | null>(null);
  const router = useRouter();

  const canEdit = canWrite && request.status === "open";

  return (
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
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => setDialog("lines")}>
            <ListIcon />
            View lines
          </DropdownMenuItem>
          {canEdit ? (
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/requests/${request.id}/edit`)}
            >
              <PencilIcon />
              Edit lines
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {NEXT_STATUSES[request.status].length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Set status</DropdownMenuLabel>
            <AdvanceMenu request={request} />
          </DropdownMenuGroup>
        ) : null}
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
