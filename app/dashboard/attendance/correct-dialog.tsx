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
import type { AttendanceStatus, DayRow, ShiftOption } from "@/types/attendance";

import {
  STATUS_LABELS,
  STATUS_ORDER,
  buildCorrectionInput,
  canSubmitCorrection,
  commitCorrect,
  draftOf,
  withCurrent,
} from "./attendance-commit";

// Changing an already recorded row: the status and/or the shift worked, with a
// mandatory reason that lands in the audit log. The form is its own component
// so it can be rendered without the dialog around it.
export function CorrectForm({
  row,
  shifts,
  date,
  workerLabel,
  onDone,
}: {
  row: DayRow;
  shifts: ShiftOption[];
  date: string;
  workerLabel: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(() => draftOf(row));

  const shiftItems = withCurrent(shifts, row.record?.shiftDefId ?? "").map(
    (shift) => ({ label: shift.label, value: shift.id }),
  );
  const submittable = canSubmitCorrection(row, draft);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !submittable) return;
    startTransition(async () => {
      const outcome = await commitCorrect(
        buildCorrectionInput(row, draft),
        workerLabel,
      );
      if (outcome.ok) toast.success(outcome.message);
      else toast.error(outcome.message);
      if (outcome.refresh) router.refresh();
      // A stale or refused change closes the form so it reopens on fresh data.
      if (outcome.ok || outcome.refresh) onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        <p className="text-sm text-muted-foreground">
          {workerLabel} on {date}
        </p>

        <Field>
          <FieldLabel id="correct-status-label">Status</FieldLabel>
          <ToggleGroup
            aria-labelledby="correct-status-label"
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
          <FieldLabel htmlFor="correct-shift">Shift</FieldLabel>
          <Select
            items={shiftItems}
            value={draft.shiftDefinitionId}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, shiftDefinitionId: value ?? d.shiftDefinitionId }))
            }
            disabled={pending}
          >
            <SelectTrigger id="correct-shift" className="w-full">
              <SelectValue />
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
          <FieldLabel htmlFor="correct-reason">Reason</FieldLabel>
          <Textarea
            id="correct-reason"
            value={draft.reason}
            onChange={(event) =>
              setDraft((d) => ({ ...d, reason: event.target.value }))
            }
            maxLength={500}
            disabled={pending}
            required
          />
          <FieldDescription>
            Required. It is saved in the audit log with the old and new values.
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
            {pending ? "Saving…" : "Save correction"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

// Mounted by the day view while a row is being corrected; onDone unmounts it.
export function CorrectDialog({
  row,
  shifts,
  date,
  workerLabel,
  onDone,
}: {
  row: DayRow;
  shifts: ShiftOption[];
  date: string;
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
          <DialogTitle>Correct attendance</DialogTitle>
          <DialogDescription>
            Change a recorded row. Every correction is audited.
          </DialogDescription>
        </DialogHeader>
        <CorrectForm
          row={row}
          shifts={shifts}
          date={date}
          workerLabel={workerLabel}
          onDone={onDone}
        />
      </DialogContent>
    </Dialog>
  );
}
