"use client";

import { useState, useTransition } from "react";
import { CalendarClockIcon, EllipsisIcon, PencilIcon, PowerIcon } from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import type { SiteLocationOption, SiteOption, ShiftRow } from "@/types/forms";
import { GENERIC_ERROR } from "@/lib/action-state";
import {
  createShift,
  deleteShift,
  updateShift,
} from "@/app/dashboard/shifts/actions";
import { RowDeleteItem } from "@/components/row-delete-item";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ShiftFieldErrors = Record<string, string>;

type SelectOption = {
  label: string;
  value: string | null;
  disabled?: boolean;
};

function showFailure(
  result: ActionState,
  setErrors: (value: ShiftFieldErrors | undefined) => void,
  setMessage: (value: string) => void,
) {
  if (result.fieldErrors) setErrors(result.fieldErrors);
  if (result.message) setMessage(result.message);
}

function toSelectItems(
  options: Array<{ id: string; name: string }>,
  placeholder: string,
): SelectOption[] {
  return [
    { label: placeholder, value: null, disabled: true },
    ...options.map((option) => ({ label: option.name, value: option.id })),
  ];
}

// The location options admissible for one site pick: nothing picked keeps
// every option, a picked site narrows to its own locations.
function siteLocationOptionsFor(
  siteLocations: SiteLocationOption[],
  siteId: string | null,
): SiteLocationOption[] {
  return siteId === null
    ? siteLocations
    : siteLocations.filter((option) => option.siteId === siteId);
}

function SelectField({
  id,
  label,
  items,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string;
  label: string;
  items: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <Field data-invalid={error ? "true" : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full" disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem
                key={item.value ?? "placeholder"}
                value={item.value}
                disabled={item.disabled}
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error ? <FieldError errors={[{ message: error }]} /> : null}
    </Field>
  );
}

function LocationSelect({
  id,
  items,
  value,
  pinnedName,
  onChange,
  error,
}: {
  id: string;
  items: SelectOption[];
  value: string | null;
  // An admin actor's location is pinned server-side — their own binding
  // name is the only item and it renders disabled, so the pick stays
  // visible but is not changeable. Undefined for ho/superadmin, who pick
  // normally (an ho's items are already limited to their own site).
  pinnedName?: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const itemsToRender: SelectOption[] =
    pinnedName !== undefined
      ? [{ label: pinnedName, value: value ?? "", disabled: true }]
      : items;
  return (
    <SelectField
      id={id}
      label="Location"
      items={itemsToRender}
      value={value}
      disabled={pinnedName !== undefined}
      onChange={onChange}
      error={error}
    />
  );
}

export function ShiftForm({
  siteLocations,
  sites,
  pinnedLocationName,
  shift,
  onSaved,
}: {
  siteLocations: SiteLocationOption[];
  // Site masters for the site-first pick, already scoped per role by the
  // page (superadmin: all sites, ho: their one, admin: their binding's).
  sites: SiteOption[];
  // An admin actor's site_location id — their location select is pinned
  // (server-side override), so it renders disabled with their name.
  pinnedLocationName?: string;
  shift?: ShiftRow;
  onSaved: () => void;
}) {
  // An admin's effective location is their binding, never the input.
  const [siteId, setSiteId] = useState<string | null>(shift?.siteId ?? null);
  const [siteLocationId, setSiteLocationId] = useState<string | null>(
    shift?.siteLocationId ?? null,
  );
  const [label, setLabel] = useState(shift?.label ?? "");
  const [orderIndex, setOrderIndex] = useState(String(shift?.orderIndex ?? ""));
  const [startTime, setStartTime] = useState(shift?.startTime ?? "");
  const [endTime, setEndTime] = useState(shift?.endTime ?? "");
  const [fieldErrors, setFieldErrors] = useState<ShiftFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const isEdit = !!shift;
  // The site pick only scopes the location options client-side — an actor
  // with a single site (ho) or a pinned location (admin) gets no site
  // select at all, and the picked site is never submitted: the action
  // derives siteId from the site_location.
  const showSiteSelect = pinnedLocationName === undefined && sites.length > 1;
  const locationOptions = showSiteSelect
    ? siteLocationOptionsFor(siteLocations, siteId)
    : siteLocations;
  const locationItems: SelectOption[] =
    showSiteSelect && siteId === null
      ? [{ label: "Select a site first", value: null, disabled: true }]
      : toSelectItems(locationOptions, "Select a location");
  const locationValue =
    pinnedLocationName !== undefined
      ? // For an admin the only admissible pick is their own binding: the
        // row's location on edit, their option (the page shrinks their
        // siteLocations to their binding) on create.
        shift?.siteLocationId ?? (siteLocations[0]?.id ?? null)
      : siteLocationId;

  // Client-side guard mirroring the shape validator: the normalized order
  // slot must be an integer 1..20 before the action is even called.
  const parsedOrderIndex = Number.parseInt(orderIndex, 10);
  const orderIsValid =
    Number.isInteger(parsedOrderIndex) &&
    parsedOrderIndex >= 1 &&
    parsedOrderIndex <= 20;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // A shift must bind a location and an order slot; a missing pick
    // surfaces the local field error and skips the server action.
    const errors: ShiftFieldErrors = {};
    if (!locationValue) {
      errors.siteLocationId = "Location is required";
    }
    if (!label.trim()) {
      errors.label = "Label is required";
    }
    if (!orderIsValid) {
      errors.orderIndex = "Order must be a number between 1 and 20";
    }
    if (!startTime || !endTime) {
      errors.startTime = "Both start and end times are required";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    startTransition(async () => {
      // Narrowed again inside the async closure (the guard above only
      // collected errors): the shift schemas require a real site_location
      // id, so the action call sites need the string, never undefined.
      if (!locationValue) {
        setFieldErrors({ siteLocationId: "Location is required" });
        return;
      }
      // siteId is never sent: the action derives it from the site_location.
      const result = isEdit
        ? await updateShift(shift.id, {
            id: shift.id,
            siteLocationId: locationValue,
            label,
            orderIndex: parsedOrderIndex,
            startTime,
            endTime,
            isActive: shift.isActive,
          })
        : await createShift({
            siteLocationId: locationValue,
            label,
            orderIndex: parsedOrderIndex,
            startTime,
            endTime,
          });

      if (result.ok) {
        toast.success(isEdit ? "Shift updated." : "Shift created.");
        onSaved();
        return;
      }
      showFailure(result, setFieldErrors, setMessage);
      if (result.message) toast.error(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        {message ? <FieldError>{message}</FieldError> : null}

        {showSiteSelect ? (
          <SelectField
            id="shift-site"
            label="Site"
            items={toSelectItems(sites, "Select a site")}
            value={siteId}
            onChange={(next) => {
              // A site switch invalidates the location pick — the previous
              // location may belong to the old site.
              setSiteLocationId(null);
              setSiteId(next);
            }}
            error={fieldErrors?.siteId}
          />
        ) : null}

        <LocationSelect
          id="shift-location"
          items={locationItems}
          value={locationValue}
          pinnedName={pinnedLocationName}
          onChange={setSiteLocationId}
          error={fieldErrors?.siteLocationId}
        />

        <div className="grid grid-cols-2 gap-4">
          <Field data-invalid={fieldErrors?.startTime ? "true" : undefined}>
            <FieldLabel htmlFor="shift-start">Start time</FieldLabel>
            <Input
              id="shift-start"
              name="startTime"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              aria-invalid={fieldErrors?.startTime ? true : undefined}
              required
            />
            {fieldErrors?.startTime ? (
              <FieldError errors={[{ message: fieldErrors.startTime }]} />
            ) : null}
          </Field>
          <Field data-invalid={fieldErrors?.endTime ? "true" : undefined}>
            <FieldLabel htmlFor="shift-end">End time</FieldLabel>
            <Input
              id="shift-end"
              name="endTime"
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              aria-invalid={fieldErrors?.endTime ? true : undefined}
              required
            />
          </Field>
        </div>

        <Field data-invalid={fieldErrors?.label ? "true" : undefined}>
          <FieldLabel htmlFor="shift-label">Shift label</FieldLabel>
          <Input
            id="shift-label"
            name="label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            aria-invalid={fieldErrors?.label ? true : undefined}
            maxLength={200}
            required
          />
          {fieldErrors?.label ? (
            <FieldError errors={[{ message: fieldErrors.label }]} />
          ) : null}
        </Field>
        <Field data-invalid={fieldErrors?.orderIndex ? "true" : undefined}>
          <FieldLabel htmlFor="shift-order">Order</FieldLabel>
          <Input
            id="shift-order"
            name="orderIndex"
            type="number"
            inputMode="numeric"
            value={orderIndex}
            onChange={(event) => setOrderIndex(event.target.value)}
            aria-invalid={fieldErrors?.orderIndex ? true : undefined}
            min={1}
            max={20}
            step={1}
            required
          />
          {fieldErrors?.orderIndex ? (
            <FieldError errors={[{ message: fieldErrors.orderIndex }]} />
          ) : null}
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function CreateShiftButton({
  siteLocations,
  sites,
  pinnedLocationName,
}: {
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  pinnedLocationName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <CalendarClockIcon data-icon="inline-start" />
        Add shift
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New shift</DialogTitle>
          <DialogDescription>
            Shifts are the labeled day slots inside a location that the
            roster places workers into.
          </DialogDescription>
        </DialogHeader>
        <ShiftForm
          siteLocations={siteLocations}
          sites={sites}
          pinnedLocationName={pinnedLocationName}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ShiftRowActions({
  shift,
  siteLocations,
  sites,
  pinnedLocationName,
}: {
  shift: ShiftRow;
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  pinnedLocationName?: string;
}) {
  const [dialog, setDialog] = useState<"edit" | "delete" | "toggle" | null>(
    null,
  );
  const [pending] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${shift.label}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={pending}
            variant={shift.isActive ? "destructive" : undefined}
            onClick={() => setDialog("toggle")}
          >
            <PowerIcon />
            {shift.isActive ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <RowDeleteItem isActive={shift.isActive} onOpen={() => setDialog("delete")} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialogs live outside the menu popup so the menu can
      close before their layer opens. */}
      <EditShiftDialog
        shift={shift}
        siteLocations={siteLocations}
        sites={sites}
        pinnedLocationName={pinnedLocationName}
        open={dialog === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <DeleteShiftDialog
        shift={shift}
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <ToggleShiftDialog
        shift={shift}
        open={dialog === "toggle"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function ToggleShiftDialog({
  shift,
  open,
  onOpenChange,
}: {
  shift: ShiftRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const activating = !shift.isActive;
  const verb = activating ? "Activate" : "Deactivate";

  function handleConfirm() {
    startTransition(async () => {
      // No toggle action exists for shifts — the flip rides updateShift
      // with the row's own (already in-scope) values preserved.
      const result = await updateShift(shift.id, {
        id: shift.id,
        siteLocationId: shift.siteLocationId,
        label: shift.label,
        orderIndex: shift.orderIndex,
        startTime: shift.startTime,
        endTime: shift.endTime,
        isActive: !shift.isActive,
      });
      if (result.ok) {
        onOpenChange(false);
        toast.success(activating ? "Shift activated." : "Shift deactivated.");
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} “{shift.label}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The shift will be marked {activating ? "active" : "inactive"}.
            Inactive shifts are hidden from the roster and from new requests.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={activating ? undefined : "destructive"}
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? `${verb.slice(0, -2)}ing…` : verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditShiftDialog({
  shift,
  siteLocations,
  sites,
  pinnedLocationName,
  open,
  onOpenChange,
}: {
  shift: ShiftRow;
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  pinnedLocationName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit shift</DialogTitle>
          <DialogDescription>
            Update the shift&apos;s label, order, or time window.
          </DialogDescription>
        </DialogHeader>
        <ShiftForm
          shift={shift}
          siteLocations={siteLocations}
          sites={sites}
          pinnedLocationName={pinnedLocationName}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteShiftDialog({
  shift,
  open,
  onOpenChange,
}: {
  shift: ShiftRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteShift(shift.id);
      if (result.ok) {
        onOpenChange(false);
        toast.success("Shift deleted.");
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete shift</AlertDialogTitle>
          <AlertDialogDescription>
            “{shift.label}” will be hidden from the list and its order slot
            freed. Shifts referenced by requests cannot be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
