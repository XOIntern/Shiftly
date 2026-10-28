"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  AreaOption,
  AttendanceStatus,
  CandidateWorker,
  DayRow,
  ShiftOption,
} from "@/types/attendance";

import {
  STATUS_LABELS,
  STATUS_ORDER,
  buildUnscheduledInput,
  candidatesFor,
  canSubmitUnscheduled,
  commitAddUnscheduled,
  commitRemoveUnscheduled,
  selectable,
  type UnscheduledDraft,
} from "./attendance-commit";

// Recording a worker who is not on the roster that day, and removing a
// mistaken unscheduled row. Both carry a mandatory reason that lands in the
// audit log. Each form is its own component so it can be rendered without the
// dialog around it.

const EMPTY_DRAFT: UnscheduledDraft = {
  workerId: "",
  workAreaId: "",
  shiftDefinitionId: "",
  status: "present",
  reason: "",
};

export function UnscheduledForm({
  date,
  candidates,
  excludeWorkerIds,
  shifts,
  areas,
  onDone,
}: {
  date: string;
  candidates: CandidateWorker[];
  excludeWorkerIds: string[];
  shifts: ShiftOption[];
  areas: AreaOption[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<UnscheduledDraft>(EMPTY_DRAFT);

  const workers = candidatesFor(candidates, excludeWorkerIds);
  const workerItems = workers.map((w) => ({
    label: `${w.employeeId} ${w.name}`,
    value: w.id,
  }));
  const shiftItems = selectable(shifts).map((s) => ({
    label: s.label,
    value: s.id,
  }));
  const areaItems = selectable(areas).map((a) => ({
    label: a.name,
    value: a.id,
  }));
  const submittable = canSubmitUnscheduled(draft);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !submittable) return;
    const label =
      workerItems.find((item) => item.value === draft.workerId)?.label ??
      "Worker";
    startTransition(async () => {
      const outcome = await commitAddUnscheduled(
        buildUnscheduledInput(date, draft),
        label,
      );
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
      if (outcome.refresh) router.refresh();
      if (outcome.ok || outcome.refresh) onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        <p className="text-sm text-muted-foreground">
          Recording for {date}. Use this for a worker who is not on the roster
          that day.
        </p>

        <Field>
          <FieldLabel htmlFor="unscheduled-worker">Worker</FieldLabel>
          <Select
            items={workerItems}
            value={draft.workerId || null}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, workerId: value ?? "" }))
            }
            disabled={pending || workerItems.length === 0}
          >
            <SelectTrigger id="unscheduled-worker" className="w-full">
              <SelectValue placeholder="Select a worker" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {workerItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {workerItems.length === 0 ? (
            <FieldDescription>
              Every active worker of this location is already on the list.
            </FieldDescription>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="unscheduled-shift">Shift</FieldLabel>
          <Select
            items={shiftItems}
            value={draft.shiftDefinitionId || null}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, shiftDefinitionId: value ?? "" }))
            }
            disabled={pending}
          >
            <SelectTrigger id="unscheduled-shift" className="w-full">
              <SelectValue placeholder="Select a shift" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {shiftItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="unscheduled-area">Work area</FieldLabel>
          <Select
            items={areaItems}
            value={draft.workAreaId || null}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, workAreaId: value ?? "" }))
            }
            disabled={pending}
          >
            <SelectTrigger id="unscheduled-area" className="w-full">
              <SelectValue placeholder="Select a work area" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {areaItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel id="unscheduled-status-label">Status</FieldLabel>
          <ToggleGroup
            aria-labelledby="unscheduled-status-label"
            variant="outline"
            value={[draft.status]}
            onValueChange={(value) => {
              const next = value[0] as AttendanceStatus | undefined;
              if (next) setDraft((d) => ({ ...d, status: next }));
            }}
            disabled={pending}
          >
            {STATUS_ORDER.map((status) => (
              <ToggleGroupItem
                key={status}
                value={status}
                className="min-h-11 sm:min-h-8"
              >
                {STATUS_LABELS[status]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Field>
          <FieldLabel htmlFor="unscheduled-reason">Reason</FieldLabel>
          <Textarea
            id="unscheduled-reason"
            value={draft.reason}
            onChange={(event) =>
              setDraft((d) => ({ ...d, reason: event.target.value }))
            }
            maxLength={500}
            disabled={pending}
            required
          />
          <FieldDescription>
            Required. It is saved in the audit log.
          </FieldDescription>
        </Field>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onDone}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !submittable}>
            {pending ? "Saving…" : "Add unscheduled worker"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function UnscheduledDialog({
  date,
  candidates,
  excludeWorkerIds,
  shifts,
  areas,
  onDone,
}: {
  date: string;
  candidates: CandidateWorker[];
  excludeWorkerIds: string[];
  shifts: ShiftOption[];
  areas: AreaOption[];
  onDone: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add unscheduled worker</DialogTitle>
          <DialogDescription>
            Record attendance for a worker who is not on the roster. The reason
            is audited.
          </DialogDescription>
        </DialogHeader>
        <UnscheduledForm
          date={date}
          candidates={candidates}
          excludeWorkerIds={excludeWorkerIds}
          shifts={shifts}
          areas={areas}
          onDone={onDone}
        />
      </DialogContent>
    </Dialog>
  );
}

export function RemoveUnscheduledForm({
  row,
  workerLabel,
  onDone,
}: {
  row: DayRow;
  workerLabel: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const submittable = reason.trim() !== "" && !!row.record;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !submittable || !row.record) return;
    const recordId = row.record.id;
    startTransition(async () => {
      const outcome = await commitRemoveUnscheduled(
        { recordId, reason },
        workerLabel,
      );
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
      if (outcome.refresh) router.refresh();
      if (outcome.ok || outcome.refresh) onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        <p className="text-sm text-muted-foreground">
          {workerLabel} will no longer have attendance for this day.
        </p>
        <Field>
          <FieldLabel htmlFor="remove-reason">Reason</FieldLabel>
          <Textarea
            id="remove-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            disabled={pending}
            required
          />
          <FieldDescription>
            Required. The removed row is kept in the audit log.
          </FieldDescription>
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onDone}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={pending || !submittable}
          >
            {pending ? "Removing…" : "Remove row"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function RemoveUnscheduledDialog({
  row,
  workerLabel,
  onDone,
}: {
  row: DayRow;
  workerLabel: string;
  onDone: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove unscheduled row</DialogTitle>
          <DialogDescription>
            Only unscheduled rows can be removed. Roster rows are corrected
            instead.
          </DialogDescription>
        </DialogHeader>
        <RemoveUnscheduledForm
          row={row}
          workerLabel={workerLabel}
          onDone={onDone}
        />
      </DialogContent>
    </Dialog>
  );
}
