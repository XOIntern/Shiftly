"use client";

import { useState, useTransition } from "react";
import {
  BoxesIcon,
  EllipsisIcon,
  PencilIcon,
  PowerIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import type {
  DepartmentOption,
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
  FieldDescription,
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
    <Field data-invalid={error ? "true" : undefined}>
      <FieldLabel htmlFor={id}>Location</FieldLabel>
      <Select
        items={itemsToRender}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {itemsToRender.map((item) => (
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

function WorkAreaForm({
  departments,
  siteLocations,
  pinnedLocationName,
  workArea,
  onSaved,
}: {
  departments: DepartmentOption[];
  siteLocations: SiteLocationOption[];
  // An admin actor's site_location id — their location select is pinned
  // (server-side override), so it renders disabled with their name.
  pinnedLocationName?: string;
  workArea?: WorkAreaRow;
  onSaved: () => void;
}) {
  const [departmentId, setDepartmentId] = useState<string | null>(
    workArea?.departmentId ?? null,
  );
  // An admin's effective location is their binding, never the input.
  const [siteLocationId, setSiteLocationId] = useState<string | null>(
    workArea?.siteLocationId ?? null,
  );
  const [name, setName] = useState(workArea?.name ?? "");
  const [fieldErrors, setFieldErrors] = useState<WorkAreaFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const isEdit = !!workArea;
  const departmentItems = toSelectItems(departments, "Select a department");
  const locationItems = toSelectItems(siteLocations, "Select a location");
  const locationValue =
    pinnedLocationName !== undefined
      ? // For an admin the only admissible pick is their own binding: the
        // row's location on edit, their option (the page shrinks their
        // siteLocations to their binding) on create.
        workArea?.siteLocationId ?? (siteLocations[0]?.id ?? null)
      : siteLocationId;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // Pre-submit department guard (mirroring locations' site guard): a work
    // area must reference a department; a missing pick surfaces the local
    // field error and skips the server action entirely.
    if (!departmentId) {
      setFieldErrors({ departmentId: "Department is required" });
      return;
    }

    startTransition(async () => {
      // Absent optional selects submit undefined, never null/"" — the
      // keptBindings/uuid validators would turn a null into a misleading
      // per-field error. siteId is never sent: the action derives it from
      // the department.
      const result = isEdit
        ? await updateWorkArea(workArea.id, {
            departmentId,
            siteLocationId: locationValue ?? undefined,
            name,
            isActive: workArea.isActive,
          })
        : await createWorkArea({
            departmentId,
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

        <Field data-invalid={fieldErrors?.departmentId ? "true" : undefined}>
          <FieldLabel htmlFor="work-area-department">Department</FieldLabel>
          <Select
            items={departmentItems}
            value={departmentId}
            onValueChange={(value) => {
              if (value !== null) setDepartmentId(value);
            }}
          >
            <SelectTrigger id="work-area-department" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {departmentItems.map((item) => (
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
          {departments.length === 0 ? (
            <FieldDescription>
              No departments in your scope yet — create one first.
            </FieldDescription>
          ) : null}
          {fieldErrors?.departmentId ? (
            <FieldError errors={[{ message: fieldErrors.departmentId }]} />
          ) : null}
        </Field>

        <LocationSelect
          id="work-area-location"
          items={locationItems}
          value={locationValue}
          pinnedName={pinnedLocationName}
          onChange={setSiteLocationId}
          error={fieldErrors?.siteLocationId}
        />

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
  departments,
  siteLocations,
  pinnedLocationName,
}: {
  departments: DepartmentOption[];
  siteLocations: SiteLocationOption[];
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
          departments={departments}
          siteLocations={siteLocations}
          pinnedLocationName={pinnedLocationName}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function WorkAreaRowActions({
  workArea,
  departments,
  siteLocations,
  pinnedLocationName,
}: {
  workArea: WorkAreaRow;
  departments: DepartmentOption[];
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
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDialog("delete")}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialogs live outside the menu popup so the menu can
      close before their layer opens. */}
      <EditWorkAreaDialog
        workArea={workArea}
        departments={departments}
        siteLocations={siteLocations}
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
  departments,
  siteLocations,
  pinnedLocationName,
  open,
  onOpenChange,
}: {
  workArea: WorkAreaRow;
  departments: DepartmentOption[];
  siteLocations: SiteLocationOption[];
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
            Update the work area&apos;s name, department, or location.
          </DialogDescription>
        </DialogHeader>
        <WorkAreaForm
          departments={departments}
          siteLocations={siteLocations}
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
