"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EllipsisIcon, ListIcon, PencilIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";

import type { MpRequestLineView, MpRequestRow } from "@/types/mp-request";
import { GENERIC_ERROR } from "@/lib/action-state";
import { runExclusive } from "@/lib/run-exclusive";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import { withdrawRequest } from "@/app/dashboard/requests/actions";
import {
  isRequestMutable,
  RequestStatusBadge,
  rosterHrefFor,
} from "@/app/dashboard/requests/request-status";
import { ConfirmDialog } from "@/components/confirm-dialog";
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

// Edit and Withdraw follow the request's own state (see isRequestMutable);
// only roles that write requests are offered them.
export const canEditRequest = (
  request: MpRequestRow,
  canWrite: boolean,
): boolean => canWrite && isRequestMutable(request);

export const canWithdrawRequest = (
  request: MpRequestRow,
  canWrite: boolean,
): boolean => canWrite && isRequestMutable(request);

type DialogCopy = { title: string; body: string };

const WITHDRAW_BODY =
  "It stays in the list as Withdrawn and cannot be restored. You can create a new request for the same period afterwards.";

// A daily request can already have fills in the roster; say what happens to
// them. The copy lives in pure helpers because the dialog parts cannot render
// outside an open dialog, so tests pin the strings here.
export const withdrawDialogCopy = (request: MpRequestRow): DialogCopy => ({
  title: "Withdraw this request?",
  body:
    request.type === "daily"
      ? `${WITHDRAW_BODY} Fills already made stay in the roster.`
      : WITHDRAW_BODY,
});

const periodLabel = (request: MpRequestRow): string =>
  request.type === "weekly"
    ? `week of ${request.weekStart}`
    : `date ${request.requestDate}`;

// "<site> <location>": the site name is empty in some scopes, so join what
// exists instead of leaving a double space.
const requestLabel = (request: MpRequestRow): string =>
  [request.siteName, request.locationName].filter(Boolean).join(" ");

export function MpRequestRowActions({
  request,
  canWrite,
}: {
  request: MpRequestRow;
  // May the actor write request lines? Admin (own location) and superadmin
  // only: an ho carries the view entry alone.
  canWrite: boolean;
}) {
  const [dialog, setDialog] = useState<"lines" | "withdraw" | null>(null);
  const [withdrawing, startWithdraw] = useTransition();
  // Held here, not in the withdraw dialog: choosing Withdraw closes the menu
  // and the dialog content unmounts on close, so only this component can
  // guard a second submit.
  const withdrawLock = useRef(false);
  // The withdrawn row keeps its Actions button, but the dialog closes while
  // `withdrawing` still disables it; focus goes back once that ends.
  const {
    openerRef,
    arm: armFocusRestore,
    onDialogClosed,
  } = useFocusRestore(withdrawing);
  const router = useRouter();
  const withdrawCopy = withdrawDialogCopy(request);

  function withdraw() {
    armFocusRestore();
    startWithdraw(async () => {
      await runExclusive(withdrawLock, async () => {
        try {
          const result = await withdrawRequest(request.id);
          if (result.ok) {
            toast.success("Request withdrawn.");
            return;
          }
          toast.error(result.message ?? GENERIC_ERROR);
        } catch {
          toast.error(GENERIC_ERROR);
        } finally {
          setDialog(null);
        }
      });
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              ref={openerRef}
              disabled={withdrawing}
              aria-label={`Actions for request ${requestLabel(request)}, ${periodLabel(request)}`}
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
          {canWithdrawRequest(request, canWrite) ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDialog("withdraw")}
                >
                  <Undo2Icon />
                  Withdraw
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
        {/* Controlled dialogs live outside the menu popup so the menu can
        close before their layer opens. */}
        <Dialog
          open={dialog === "lines"}
          onOpenChange={(open) => setDialog(open ? "lines" : null)}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Request lines</DialogTitle>
              <DialogDescription>
                {request.type === "weekly"
                  ? `Week of ${request.weekStart}`
                  : `Date ${request.requestDate}`}
              </DialogDescription>
              <RequestDetailStatus request={request} />
            </DialogHeader>
            <RequestLinesTable lines={request.lines} />
          </DialogContent>
        </Dialog>
        {canWithdrawRequest(request, canWrite) ? (
          <ConfirmDialog
            open={dialog === "withdraw"}
            onOpenChange={(open) => setDialog(open ? "withdraw" : null)}
            pending={withdrawing}
            title={withdrawCopy.title}
            body={withdrawCopy.body}
            cancelLabel="Keep request"
            confirmLabel="Withdraw"
            onConfirm={withdraw}
            onCloseComplete={onDialogClosed}
          />
        ) : null}
      </DropdownMenu>
    </div>
  );
}

// The status row of the detail dialog's header: the badge (its text carries
// the status, not colour) and the roster link once a weekly request has a
// roster week. Exported so SSR tests can pin it — the dialog mounts closed,
// and the dialog title parts cannot render outside an open dialog.
export function RequestDetailStatus({ request }: { request: MpRequestRow }) {
  const rosterHref = rosterHrefFor(request);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RequestStatusBadge status={request.status} />
      {rosterHref ? (
        <Link
          href={rosterHref}
          className="text-sm font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View in roster <span aria-hidden="true">→</span>
        </Link>
      ) : null}
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
