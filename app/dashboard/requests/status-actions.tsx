"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  EllipsisIcon,
  ListIcon,
  Loader2Icon,
  PencilIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { MpRequestLineView, MpRequestRow } from "@/types/mp-request";
import { GENERIC_ERROR } from "@/lib/action-state";
import { focusFallbackTarget } from "@/lib/final-focus";
import { runExclusive } from "@/lib/run-exclusive";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import {
  advanceStatus,
  withdrawRequest,
} from "@/app/dashboard/requests/actions";
import {
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

// Withdrawing retracts a request the admin entered, so it is offered to the
// roles that write requests and only while the request is still open.
export const canWithdrawRequest = (
  request: MpRequestRow,
  canWrite: boolean,
): boolean => canWrite && request.status === "open";

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

export const rejectDialogCopy = (): DialogCopy => ({
  title: "Reject this request?",
  body: "This cannot be undone. The admin will need to enter a new request.",
});

// Approving cannot be undone either; the dialog says what it commits to.
export const approveDialogCopy = (): DialogCopy => ({
  title: "Approve this request?",
  body: "This request becomes the basis for the week's roster.",
});

const periodLabel = (request: MpRequestRow): string =>
  request.type === "weekly"
    ? `week of ${request.weekStart}`
    : `date ${request.requestDate}`;

export function RowApproval({ request }: { request: MpRequestRow }) {
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"approved" | "rejected" | null>(null);
  const [confirming, setConfirming] = useState<
    "approved" | "rejected" | null
  >(null);
  // The ref lock and the pending flag live here, not in the dialog: the
  // dialog content unmounts when it closes, this component stays mounted.
  const lock = useRef(false);
  // True only when a dialog closes on a successful approve or reject: the
  // row stays (as Approved or Rejected) but its inline buttons are removed,
  // so focus goes to the page title.
  const succeeded = useRef(false);
  // After a failure the dialog closes while the refresh still disables the
  // buttons; focus goes back to the button that opened it once that ends.
  const {
    openerRef,
    arm: armFocusRestore,
    onDialogClosed,
  } = useFocusRestore(pending);
  const period = periodLabel(request);
  const approveCopy = approveDialogCopy();
  const rejectCopy = rejectDialogCopy();
  const focusAfterClose = () => focusFallbackTarget(succeeded.current);

  function confirm(
    nextStatus: "approved" | "rejected",
    opener: HTMLButtonElement,
  ) {
    succeeded.current = false;
    openerRef.current = opener;
    setConfirming(nextStatus);
  }

  function decide(nextStatus: "approved" | "rejected") {
    setChoice(nextStatus);
    startTransition(async () => {
      await runExclusive(lock, async () => {
        try {
          const result = await advanceStatus(request.id, nextStatus);
          if (result.ok) {
            succeeded.current = true;
            toast.success(
              nextStatus === "approved"
                ? "Request approved."
                : "Request rejected.",
            );
            return;
          }
          toast.error(result.message ?? GENERIC_ERROR);
          armFocusRestore();
        } catch {
          toast.error(GENERIC_ERROR);
          armFocusRestore();
        } finally {
          setConfirming(null);
        }
      });
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        aria-busy={pending && choice === "approved"}
        aria-label={`Approve request for ${period}`}
        onClick={(event) => confirm("approved", event.currentTarget)}
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
        onClick={(event) => confirm("rejected", event.currentTarget)}
      >
        {pending && choice === "rejected" ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <XIcon data-icon="inline-start" />
        )}
        Reject
      </Button>
      <ConfirmDialog
        open={confirming === "approved"}
        onOpenChange={(open) => setConfirming(open ? "approved" : null)}
        pending={pending}
        title={approveCopy.title}
        body={approveCopy.body}
        cancelLabel="Cancel"
        confirmLabel="Approve"
        confirmVariant="default"
        onConfirm={() => decide("approved")}
        finalFocus={focusAfterClose}
        onCloseComplete={onDialogClosed}
      />
      <ConfirmDialog
        open={confirming === "rejected"}
        onOpenChange={(open) => setConfirming(open ? "rejected" : null)}
        pending={pending}
        title={rejectCopy.title}
        body={rejectCopy.body}
        cancelLabel="Cancel"
        confirmLabel="Reject"
        onConfirm={() => decide("rejected")}
        finalFocus={focusAfterClose}
        onCloseComplete={onDialogClosed}
      />
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
      {canApproveRequest(request, canApprove) ? (
        <RowApproval request={request} />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              ref={openerRef}
              disabled={withdrawing}
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
          <DialogContent>
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
          View in roster →
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
