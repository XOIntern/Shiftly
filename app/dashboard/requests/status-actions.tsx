"use client";

import { useState, useTransition } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  EllipsisIcon,
  ListIcon,
  PencilIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { MpRequestRow, MpRequestGridShift, MpRequestGridWorkArea } from "@/types/mp-request";
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
import { RequestForm } from "@/app/dashboard/requests/request-form";

// Manual status machine (mirror of the actions' LEGAL_TRANSITIONS — the
// two MUST stay in step): the menu renders ONLY these next statuses, so a
// terminal request shows no advance items at all.
type AdvanceItem = {
  status: "received" | "processing" | "fulfilled" | "rejected";
  label: string;
};

const NEXT_STATUSES: Record<MpRequestRow["status"], AdvanceItem[]> = {
  submitted: [{ status: "received", label: "Mark received" }],
  received: [{ status: "processing", label: "Start processing" }],
  processing: [
    { status: "fulfilled", label: "Mark fulfilled" },
    { status: "rejected", label: "Mark rejected" },
  ],
  fulfilled: [],
  rejected: [],
};

function AdvanceMenu({ request }: { request: MpRequestRow }) {
  const [pending, startTransition] = useTransition();

  function advance(nextStatus: "received" | "processing" | "fulfilled" | "rejected") {
    startTransition(async () => {
      const result = await advanceStatus(request.id, nextStatus);
      if (result.ok) {
        toast.success(
          nextStatus === "received"
            ? "Request marked received."
            : nextStatus === "processing"
              ? "Request started processing."
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
  activeWorkAreas,
  activeShifts,
}: {
  request: MpRequestRow;
  // May the actor write request lines? Admin (own location) and superadmin
  // only — an ho carries the view + status menu alone.
  canWrite: boolean;
  activeWorkAreas: MpRequestGridWorkArea[];
  activeShifts: MpRequestGridShift[];
}) {
  const [dialog, setDialog] = useState<"lines" | "edit" | null>(null);

  const canEdit = canWrite && request.status === "submitted";

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
            <DropdownMenuItem onClick={() => setDialog("edit")}>
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
      <Dialog open={dialog === "lines"} onOpenChange={(open) => setDialog(open ? "lines" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request lines</DialogTitle>
            <DialogDescription>
              {request.type === "weekly"
                ? `Week of ${request.weekStart}`
                : `Date ${request.requestDate}`}
              {request.notes ? ` — ${request.notes}` : ""}
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Work area</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Headcount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.lines.map((line, index) => (
                <TableRow key={`${line.workAreaId}|${line.shiftDefinitionId}|${line.date}|${index}`}>
                  <TableCell>{line.workAreaName}</TableCell>
                  <TableCell>{line.shiftLabel}</TableCell>
                  <TableCell className="tabular-nums">{line.date}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.headcount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
      {canEdit ? (
        <Dialog
          open={dialog === "edit"}
          onOpenChange={(open) => setDialog(open ? "edit" : null)}
        >
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Edit request lines</DialogTitle>
              <DialogDescription>
                The anchor (week or date) is fixed after creation; edit the
                headcounts within it.
              </DialogDescription>
            </DialogHeader>
            <RequestForm
              type={request.type}
              siteLocationId={request.siteLocationId}
              siteLocations={[]}
              sites={[]}
              activeWorkAreas={activeWorkAreas}
              activeShifts={activeShifts}
              request={request}
              onSaved={() => setDialog(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </DropdownMenu>
  );
}
