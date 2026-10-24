"use client";

import { useState, useTransition } from "react";
import {
  EllipsisIcon,
  PencilIcon,
  PowerIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import type { PositionRow } from "@/types/position";
import type { SiteOption, SiteLocationOption } from "@/types/site";
import type { WorkerRow } from "@/types/worker";
import { GENERIC_ERROR } from "@/lib/action-state";
import {
  createWorker,
  deleteWorker,
  toggleWorker,
  updateWorker,
} from "@/app/dashboard/workers/actions";
import { siteLocationOptionsFor } from "@/components/work-areas/work-area-form";
import {
  positionLabel,
  visiblePositionOptions,
} from "@/components/positions/position-options";
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
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox";
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

type WorkerFieldErrors = Record<string, string>;

type SelectOption = {
  label: string;
  value: string | null;
  disabled?: boolean;
};

function showFailure(
  result: ActionState,
  setErrors: (value: WorkerFieldErrors | undefined) => void,
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
  // An admin's location is pinned server-side — their own binding name is
  // the only item and it renders disabled, so the pick stays visible but
  // is not changeable. Undefined for ho/superadmin, who pick normally.
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

// Shared with the work-area edit dialog, which reuses the same picker rules.
export {
  positionOptionsFor,
  visiblePositionOptions,
  positionLabel,
} from "@/components/positions/position-options";

export function WorkerForm({
  positions,
  sites,
  siteLocations,
  pinnedLocationName,
  worker,
  onSaved,
}: {
  positions: PositionRow[];
  // Site masters for the site-first pick, already scoped per role by the
  // page (superadmin: all sites, ho: their one, admin: their binding's).
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  // An admin actor's site_location id — their location select is pinned
  // (server-side override), so it renders disabled with their name.
  pinnedLocationName?: string;
  worker?: WorkerRow;
  onSaved: () => void;
}) {
  // An admin's effective location is their binding, never the input.
  const [siteId, setSiteId] = useState<string | null>(
    worker?.siteId ?? null,
  );
  const [siteLocationId, setSiteLocationId] = useState<string | null>(
    worker?.siteLocationId ?? null,
  );
  const [positionIds, setPositionIds] = useState<string[]>(
    worker?.positions.map((position) => position.id) ?? [],
  );
  const [employeeId, setEmployeeId] = useState(worker?.employeeId ?? "");
  const [name, setName] = useState(worker?.name ?? "");
  const [contractEndDate, setContractEndDate] = useState(
    worker?.contractEndDate ?? "",
  );
  const [fieldErrors, setFieldErrors] = useState<WorkerFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const isEdit = !!worker;
  // The site pick only scopes the options client-side — an actor with a
  // single site (ho) or a pinned location (admin) gets no site select at
  // all, and the picked site is never submitted: the action derives siteId
  // from the site_location.
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
        worker?.siteLocationId ?? (siteLocations[0]?.id ?? null)
      : siteLocationId;

  // Positions live under a site, so the picker unlocks once the site
  // resolves: through the site pick when there is one, otherwise through
  // the picked location (single-site scopes, pinned admins) or the
  // worker's own site on edit.
  const pickedLocation =
    siteLocations.find((option) => option.id === locationValue) ?? null;
  const positionSiteId = showSiteSelect
    ? siteId
    : (pickedLocation?.siteId ?? worker?.siteId ?? null);
  const renderedPositions = visiblePositionOptions(
    positions,
    positionSiteId,
    positionIds,
  );
  // Chips are positional in Base UI (its chip removal reads the selected
  // value by index), so the value array must follow the chip order.
  const selectedPositions = positionIds.flatMap((id) => {
    const option = renderedPositions.find((candidate) => candidate.id === id);
    return option ? [option] : [];
  });
  const positionPlaceholder =
    positionSiteId === null
      ? showSiteSelect
        ? "Select a site first"
        : "Select a location first"
      : renderedPositions.length === 0
        ? "No positions for this site yet"
        : "Select positions";

  // A location move only invalidates the set when the resolved site changes;
  // a same-site move keeps every pick.
  function handleLocationChange(next: string) {
    const nextSiteId =
      siteLocations.find((option) => option.id === next)?.siteId ?? null;
    if (nextSiteId !== positionSiteId) setPositionIds([]);
    setSiteLocationId(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // Pre-submit pick guards (mirrors the work-area form's): a worker must
    // bind a location AND at least one position; the first missing pick
    // surfaces the local field error and skips the server action entirely.
    if (!locationValue) {
      setFieldErrors({ siteLocationId: "Location is required" });
      return;
    }
    if (positionIds.length === 0) {
      setFieldErrors({ positionIds: "Position is required" });
      return;
    }

    startTransition(async () => {
      // Absent optional selects/inputs submit undefined, never null/"" —
      // the keptBindings/uuid validators would turn a null into a
      // misleading per-field error. siteId is never sent: the action
      // derives it from the site_location.
      const payload = {
        siteLocationId: locationValue ?? undefined,
        positionIds,
        employeeId,
        name,
        contractEndDate: contractEndDate || undefined,
      };
      const result = isEdit
        ? await updateWorker(worker.id, {
            ...payload,
            isActive: worker.isActive,
          })
        : await createWorker(payload);

      if (result.ok) {
        onSaved();
        return;
      }
      showFailure(result, setFieldErrors, setMessage);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        {message ? <FieldError>{message}</FieldError> : null}

        <Field data-invalid={fieldErrors?.employeeId ? "true" : undefined}>
          <FieldLabel htmlFor="worker-employee-id">Employee ID</FieldLabel>
          <Input
            id="worker-employee-id"
            name="employeeId"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            aria-invalid={fieldErrors?.employeeId ? true : undefined}
            maxLength={100}
            required
          />
          {fieldErrors?.employeeId ? (
            <FieldError errors={[{ message: fieldErrors.employeeId }]} />
          ) : null}
        </Field>
        <Field data-invalid={fieldErrors?.name ? "true" : undefined}>
          <FieldLabel htmlFor="worker-name">Name</FieldLabel>
          <Input
            id="worker-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={fieldErrors?.name ? true : undefined}
            maxLength={200}
            required
          />
          {fieldErrors?.name ? (
            <FieldError errors={[{ message: fieldErrors.name }]} />
          ) : null}
        </Field>

        <Field data-invalid={fieldErrors?.positionIds ? "true" : undefined}>
          <FieldLabel htmlFor="worker-positions">Positions</FieldLabel>
          <Combobox
            multiple
            items={renderedPositions}
            itemToStringLabel={(option) => option.name}
            isItemEqualToValue={(option, value) => option.id === value.id}
            value={selectedPositions}
            onValueChange={(next) =>
              setPositionIds(next.map((option) => option.id))
            }
            disabled={positionSiteId === null || renderedPositions.length === 0}
          >
            <ComboboxChips>
              <ComboboxValue>
                {selectedPositions.map((option) => (
                  <ComboboxChip
                    key={option.id}
                    aria-label={positionLabel(option)}
                    removeLabel={`Remove ${positionLabel(option)}`}
                  >
                    {positionLabel(option)}
                  </ComboboxChip>
                ))}
              </ComboboxValue>
              <ComboboxChipsInput
                id="worker-positions"
                placeholder={positionPlaceholder}
                aria-invalid={fieldErrors?.positionIds ? true : undefined}
              />
            </ComboboxChips>
            <ComboboxContent>
              <ComboboxEmpty>No matching positions.</ComboboxEmpty>
              <ComboboxList>
                {(option: PositionRow) => (
                  <ComboboxItem key={option.id} value={option}>
                    {positionLabel(option)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          {fieldErrors?.positionIds ? (
            <FieldError errors={[{ message: fieldErrors.positionIds }]} />
          ) : null}
        </Field>

        {/* The site pick scopes the position options, so it sits below the
        identity fields: Positions renders disabled until it is unlocked. */}
        {showSiteSelect ? (
          <SelectField
            id="worker-site"
            label="Site"
            items={toSelectItems(sites, "Select a site")}
            value={siteId}
            onChange={(next) => {
              // A site switch invalidates both picks — the previous
              // location/position may belong to the old site.
              setSiteLocationId(null);
              setPositionIds([]);
              setSiteId(next);
            }}
            error={fieldErrors?.siteId}
          />
        ) : null}

        <LocationSelect
          id="worker-location"
          items={locationItems}
          value={locationValue}
          pinnedName={pinnedLocationName}
          onChange={handleLocationChange}
          error={fieldErrors?.siteLocationId}
        />

        <Field data-invalid={fieldErrors?.contractEndDate ? "true" : undefined}>
          <FieldLabel htmlFor="worker-contract-end">Contract end</FieldLabel>
          <Input
            id="worker-contract-end"
            name="contractEndDate"
            type="date"
            value={contractEndDate}
            onChange={(event) => setContractEndDate(event.target.value)}
            aria-invalid={fieldErrors?.contractEndDate ? true : undefined}
            required
          />
          {fieldErrors?.contractEndDate ? (
            <FieldError errors={[{ message: fieldErrors.contractEndDate }]} />
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

export function CreateWorkerButton({
  positions,
  sites,
  siteLocations,
  pinnedLocationName,
}: {
  positions: PositionRow[];
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  pinnedLocationName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <UsersIcon data-icon="inline-start" />
        Add worker
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New worker</DialogTitle>
          <DialogDescription>
            A worker sits at a location and holds one or more positions,
            identified by their employee ID.
          </DialogDescription>
        </DialogHeader>
        <WorkerForm
          positions={positions}
          sites={sites}
          siteLocations={siteLocations}
          pinnedLocationName={pinnedLocationName}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function WorkerRowActions({
  worker,
  positions,
  sites,
  siteLocations,
  pinnedLocationName,
}: {
  worker: WorkerRow;
  positions: PositionRow[];
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
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
            aria-label={`Actions for ${worker.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={pending}
            variant={worker.isActive ? "destructive" : undefined}
            onClick={() => setDialog("toggle")}
          >
            <PowerIcon />
            {worker.isActive ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <RowDeleteItem
            isActive={worker.isActive}
            onOpen={() => setDialog("delete")}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialogs live outside the menu popup so the menu can
      close before their layer opens. */}
      <EditWorkerDialog
        worker={worker}
        positions={positions}
        sites={sites}
        siteLocations={siteLocations}
        pinnedLocationName={pinnedLocationName}
        open={dialog === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <DeleteWorkerDialog
        worker={worker}
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <ToggleWorkerDialog
        worker={worker}
        open={dialog === "toggle"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function ToggleWorkerDialog({
  worker,
  open,
  onOpenChange,
}: {
  worker: WorkerRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const activating = !worker.isActive;
  const verb = activating ? "Activate" : "Deactivate";

  function handleConfirm() {
    startTransition(async () => {
      const result = await toggleWorker(worker.id);
      if (result.ok) {
        onOpenChange(false);
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
            {verb} “{worker.name}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The worker will be marked {activating ? "active" : "inactive"}.
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

function EditWorkerDialog({
  worker,
  positions,
  sites,
  siteLocations,
  pinnedLocationName,
  open,
  onOpenChange,
}: {
  worker: WorkerRow;
  positions: PositionRow[];
  sites: SiteOption[];
  siteLocations: SiteLocationOption[];
  pinnedLocationName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit worker</DialogTitle>
          <DialogDescription>
            Update the worker&apos;s location, positions, or details.
          </DialogDescription>
        </DialogHeader>
        <WorkerForm
          positions={positions}
          sites={sites}
          siteLocations={siteLocations}
          pinnedLocationName={pinnedLocationName}
          worker={worker}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteWorkerDialog({
  worker,
  open,
  onOpenChange,
}: {
  worker: WorkerRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteWorker(worker.id);
      if (result.ok) {
        onOpenChange(false);
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete worker</AlertDialogTitle>
          <AlertDialogDescription>
            “{worker.name}” will be hidden from the list.
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
