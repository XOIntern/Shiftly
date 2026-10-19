"use client";

import { useState, useTransition } from "react";
import {
  BuildingIcon,
  EllipsisIcon,
  PencilIcon,
  PowerIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import {
  createDepartment,
  deleteDepartment,
  toggleDepartment,
  updateDepartment,
} from "@/app/dashboard/departments/actions";
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

export type SiteOption = { id: string; name: string };

// A department row the page hands the actions — siteName comes from the
// required inner join, so it can't be null.
export type DepartmentRow = {
  id: string;
  name: string;
  isActive: boolean;
  siteId: string;
  siteName: string;
};

type DepartmentFieldErrors = Record<string, string>;

type SelectOption = {
  label: string;
  value: string | null;
  disabled?: boolean;
};

function showFailure(
  result: ActionState,
  setErrors: (value: DepartmentFieldErrors | undefined) => void,
  setMessage: (value: string) => void,
) {
  if (result.fieldErrors) setErrors(result.fieldErrors);
  if (result.message) setMessage(result.message);
}

function DepartmentForm({
  sites,
  department,
  onSaved,
}: {
  sites: SiteOption[];
  department?: DepartmentRow;
  onSaved: () => void;
}) {
  const [siteId, setSiteId] = useState<string | null>(
    department?.siteId ?? null,
  );
  const [name, setName] = useState(department?.name ?? "");
  const [fieldErrors, setFieldErrors] = useState<DepartmentFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const selectItems: SelectOption[] = department
    ? sites.map((site) => ({ label: site.name, value: site.id }))
    : [
        { label: "Select a site", value: null, disabled: true },
        ...sites.map((site) => ({ label: site.name, value: site.id })),
      ];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // Pre-submit site guard (mirroring locations, issue #18): only the
    // superadmin create dialog shows a site select, so only that form can
    // miss the pick. Edits never carry a siteId.
    if (!department && sites.length > 0 && !siteId) {
      setFieldErrors({ siteId: "Site is required" });
      return;
    }

    startTransition(async () => {
      // A ho's site is pinned server-side (never sent); a superadmin edit
      // sends no siteId, keeping the current one. Edits are name-only.
      // Unselected selects submit undefined, never ""/null.
      const result = department
        ? await updateDepartment(department.id, {
            name,
            isActive: department.isActive,
          })
        : await createDepartment({
            siteId: siteId ?? undefined,
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
        {/* The site select renders for the superadmin create only: a ho's
            site is pinned server-side, and edits keep their current site. */}
        {department || sites.length === 0 ? null : (
          <Field data-invalid={fieldErrors?.siteId ? "true" : undefined}>
            <FieldLabel htmlFor="department-site">Site</FieldLabel>
            <Select
              items={selectItems}
              value={siteId}
              onValueChange={(value) => setSiteId(value as string | null)}
            >
              <SelectTrigger id="department-site" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {selectItems.map((item) => (
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
            {sites.length === 0 ? (
              <FieldDescription>
                No sites yet — create one before adding its first department.
              </FieldDescription>
            ) : null}
            {fieldErrors?.siteId ? (
              <FieldError errors={[{ message: fieldErrors.siteId }]} />
            ) : null}
          </Field>
        )}

        <Field data-invalid={fieldErrors?.name ? "true" : undefined}>
          <FieldLabel htmlFor="department-name">Department name</FieldLabel>
          <Input
            id="department-name"
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

export function CreateDepartmentButton({
  sites,
  showSiteSelect,
}: {
  sites: SiteOption[];
  // A superadmin picks the target site; an ho's site is pinned
  // server-side, so their form renders name-only.
  showSiteSelect: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <BuildingIcon data-icon="inline-start" />
        Add department
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New department</DialogTitle>
          <DialogDescription>
            Departments are the HR groupings inside a site that workers and
            their admins get bound to.
          </DialogDescription>
        </DialogHeader>
        <DepartmentForm
          sites={showSiteSelect ? sites : []}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function DepartmentRowActions({
  department,
}: {
  department: DepartmentRow;
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
            aria-label={`Actions for ${department.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={pending}
            variant={department.isActive ? "destructive" : undefined}
            onClick={() => setDialog("toggle")}
          >
            <PowerIcon />
            {department.isActive ? "Deactivate" : "Activate"}
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
      <EditDepartmentDialog
        department={department}
        open={dialog === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <DeleteDepartmentDialog
        department={department}
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <ToggleDepartmentDialog
        department={department}
        open={dialog === "toggle"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function ToggleDepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  department: DepartmentRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const activating = !department.isActive;
  const verb = activating ? "Activate" : "Deactivate";

  function handleConfirm() {
    startTransition(async () => {
      const result = await toggleDepartment(department.id);
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
            {verb} “{department.name}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The department will be marked {activating ? "active" : "inactive"}.
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

function EditDepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  department: DepartmentRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit department</DialogTitle>
          <DialogDescription>
            Update the department&apos;s name.
          </DialogDescription>
        </DialogHeader>
        {/* Name-only edit: a ho's site is pinned to their own, a
            superadmin's edit keeps the current site. */}
        <DepartmentForm sites={[]} department={department} onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DeleteDepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  department: DepartmentRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteDepartment(department.id);
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
          <AlertDialogTitle>Delete department</AlertDialogTitle>
          <AlertDialogDescription>
            “{department.name}” will be hidden from the list. Departments
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
