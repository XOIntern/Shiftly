"use client";

import { useState, useTransition } from "react";
import {
  BoxesIcon,
  EllipsisIcon,
  PencilIcon,
  PowerIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import type {
  PositionRow,
  SiteOption,
  SiteLocationOption,
  WorkAreaRow,
} from "@/types/forms";
import { GENERIC_ERROR } from "@/lib/action-state";
import {
  createWorkArea,
  deleteWorkArea,
  toggleWorkArea,
  updateWorkArea,
} from "@/app/dashboard/work-areas/actions";
import { RowDeleteItem } from "@/components/row-delete-item";
import {
  positionLabel,
  visiblePositionOptions,
} from "@/components/positions/position-options";
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

type WorkAreaFieldErrors = Record<string, string>;

type SelectOption = {
  label: string;
  value: string | null;
  disabled?: boolean;
};

function showFailure(
  result: ActionState,
  setErrors: (value: WorkAreaFieldErrors | undefined) => void,
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

// The location options admissible for one site pick: nothing picked keeps
// every option, a picked site narrows to its own locations.
export function siteLocationOptionsFor(
  siteLocations: SiteLocationOption[],
  siteId: string | null,
): SiteLocationOption[] {
  return siteId === null
    ? siteLocations
    : siteLocations.filter((option) => option.siteId === siteId);
}

export function WorkAreaForm({
  positions,
  siteLocations,
  sites,
  pinnedLocationName,
  workArea,
  onSaved,
}: {
  // The scoped position catalog the edit dialog's required-positions picker
  // offers; absent on the create dialog (the set is set-replacement only,
  // so a new area starts with none).
  positions?: PositionRow[];
  siteLocations: SiteLocationOption[];
  // Site masters for the site-first pick, already scoped per role by the
  // page (superadmin: all sites, ho: their one, admin: their binding's).
  sites: SiteOption[];
  // An admin actor's site_location id — their location select is pinned
  // (server-side override), so it renders disabled with their name.
  pinnedLocationName?: string;
  workArea?: WorkAreaRow;
  onSaved: () => void;
}) {
  // An admin's effective location is their binding, never the input.
  const [siteId, setSiteId] = useState<string | null>(
    workArea?.siteId ?? null,
  );
  const [siteLocationId, setSiteLocationId] = useState<string | null>(
    workArea?.siteLocationId ?? null,
  );
  const [name, setName] = useState(workArea?.name ?? "");
  // The area's required positions (C7 data): empty is a valid state — the
  // picker only replaces the set on edit, a new area starts with none.
  const [requiredPositionIds, setRequiredPositionIds] = useState<string[]>(
    workArea?.positions.map((option) => option.id) ?? [],
  );
  const [fieldErrors, setFieldErrors] = useState<WorkAreaFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const isEdit = !!workArea;
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
        workArea?.siteLocationId ?? (siteLocations[0]?.id ?? null)
      : siteLocationId;

  // Positions live under a site, so the edit picker resolves its site
  // through the picked location (or the area's own site as a fallback).
  const pickedLocation =
    siteLocations.find((option) => option.id === locationValue) ?? null;
  const positionSiteId = isEdit
    ? (pickedLocation?.siteId ?? workArea.siteId)
    : null;
  const renderedPositions = visiblePositionOptions(
    positions ?? [],
    positionSiteId,
    requiredPositionIds,
  );
  // Chips are positional in Base UI (its chip removal reads the selected
  // value by index), so the value array must follow the chip order.
  const selectedPositions = requiredPositionIds.flatMap((id) => {
    const option = renderedPositions.find((candidate) => candidate.id === id);
    return option ? [option] : [];
  });
  const positionPlaceholder =
    positionSiteId === null
      ? "Select a location first"
      : renderedPositions.length === 0
        ? "No positions for this site yet"
        : "Select positions";

  // A location move only invalidates the set when the resolved site changes;
  // a same-site move keeps every pick.
  function handleLocationChange(next: string) {
    const nextSiteId =
      siteLocations.find((option) => option.id === next)?.siteId ?? null;
    if (nextSiteId !== positionSiteId) setRequiredPositionIds([]);
    setSiteLocationId(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // Pre-submit site guard (mirrors the location form's, issue #18): a
    // work area must bind a location; a missing pick surfaces the local
    // field error and skips the server action entirely.
    if (!locationValue) {
      setFieldErrors({ siteLocationId: "Location is required" });
      return;
    }

    startTransition(async () => {
      // Absent optional selects submit undefined, never null/"" — the
      // keptBindings/uuid validators would turn a null into a misleading
      // per-field error. siteId is never sent: the action derives it from
      // the site_location.
      const result = isEdit
        ? await updateWorkArea(workArea.id, {
            siteLocationId: locationValue ?? undefined,
            name,
            isActive: workArea.isActive,
            // The picker owns the whole set: replaced wholesale on every
            // edit, empty clears it.
            requiredPositionIds,
          })
        : await createWorkArea({
            siteLocationId: locationValue ?? undefined,
            name,
          });

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

        {showSiteSelect ? (
          <SelectField
            id="work-area-site"
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
          id="work-area-location"
          items={locationItems}
          value={locationValue}
          pinnedName={pinnedLocationName}
          onChange={handleLocationChange}
          error={fieldErrors?.siteLocationId}
        />

        {isEdit ? (
          <Field
            data-invalid={fieldErrors?.requiredPositionIds ? "true" : undefined}
          >
            <FieldLabel htmlFor="work-area-positions">
              Required positions
            </FieldLabel>
            <Combobox
              multiple
              items={renderedPositions}
              itemToStringLabel={(option) => option.name}
              isItemEqualToValue={(option, value) => option.id === value.id}
              value={selectedPositions}
              onValueChange={(next) =>
                setRequiredPositionIds(next.map((option) => option.id))
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
                  id="work-area-positions"
                  placeholder={positionPlaceholder}
                  aria-invalid={
                    fieldErrors?.requiredPositionIds ? true : undefined
                  }
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
            {fieldErrors?.requiredPositionIds ? (
              <FieldError errors={[{ message: fieldErrors.requiredPositionIds }]} />
            ) : null}
          </Field>
        ) : null}

        <Field data-invalid={fieldErrors?.name ? "true" : undefined}>
          <FieldLabel htmlFor="work-area-name">Work area name</FieldLabel>
          <Input
            id="work-area-name"
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
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function CreateWorkAreaButton({
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
        <BoxesIcon data-icon="inline-start" />
        Add work area
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New work area</DialogTitle>
          <DialogDescription>
            Work areas are the operational zones inside a location that
            workers and their admins get bound to.
          </DialogDescription>
        </DialogHeader>
        <WorkAreaForm
          siteLocations={siteLocations}
          sites={sites}
          pinnedLocationName={pinnedLocationName}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function WorkAreaRowActions({
  workArea,
  siteLocations,
  sites,
  positions,
  pinnedLocationName,
}: {
  workArea: WorkAreaRow;
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  positions: PositionRow[];
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
            aria-label={`Actions for ${workArea.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={pending}
            variant={workArea.isActive ? "destructive" : undefined}
            onClick={() => setDialog("toggle")}
          >
            <PowerIcon />
            {workArea.isActive ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <RowDeleteItem
            isActive={workArea.isActive}
            onOpen={() => setDialog("delete")}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialogs live outside the menu popup so the menu can
      close before their layer opens. */}
      <EditWorkAreaDialog
        workArea={workArea}
        siteLocations={siteLocations}
        sites={sites}
        positions={positions}
        pinnedLocationName={pinnedLocationName}
        open={dialog === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <DeleteWorkAreaDialog
        workArea={workArea}
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <ToggleWorkAreaDialog
        workArea={workArea}
        open={dialog === "toggle"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function ToggleWorkAreaDialog({
  workArea,
  open,
  onOpenChange,
}: {
  workArea: WorkAreaRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const activating = !workArea.isActive;
  const verb = activating ? "Activate" : "Deactivate";

  function handleConfirm() {
    startTransition(async () => {
      const result = await toggleWorkArea(workArea.id);
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
            {verb} “{workArea.name}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The work area will be marked {activating ? "active" : "inactive"}.
            Workers and admins bound to it keep their bindings.
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

function EditWorkAreaDialog({
  workArea,
  siteLocations,
  sites,
  positions,
  pinnedLocationName,
  open,
  onOpenChange,
}: {
  workArea: WorkAreaRow;
  siteLocations: SiteLocationOption[];
  sites: SiteOption[];
  positions: PositionRow[];
  pinnedLocationName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit work area</DialogTitle>
          <DialogDescription>
            Update the work area&apos;s name, location, or required positions.
          </DialogDescription>
        </DialogHeader>
        <WorkAreaForm
          positions={positions}
          siteLocations={siteLocations}
          sites={sites}
          pinnedLocationName={pinnedLocationName}
          workArea={workArea}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteWorkAreaDialog({
  workArea,
  open,
  onOpenChange,
}: {
  workArea: WorkAreaRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteWorkArea(workArea.id);
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
          <AlertDialogTitle>Delete work area</AlertDialogTitle>
          <AlertDialogDescription>
            “{workArea.name}” will be hidden from the list. Work areas
            referenced by users cannot be deleted.
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
