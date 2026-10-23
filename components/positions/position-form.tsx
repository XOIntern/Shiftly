"use client";

import { useState, useTransition } from "react";
import {
  BriefcaseIcon,
  EllipsisIcon,
  PencilIcon,
  PowerIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/types/action-state";
import type { PositionRow } from "@/types/position";
import type { SiteOption } from "@/types/site";
import { GENERIC_ERROR } from "@/lib/action-state";
import {
  createPosition,
  deletePosition,
  togglePosition,
  updatePosition,
} from "@/app/dashboard/positions/actions";
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

type PositionFieldErrors = Record<string, string>;

type SelectOption = {
  label: string;
  value: string | null;
  disabled?: boolean;
};

function showFailure(
  result: ActionState,
  setErrors: (value: PositionFieldErrors | undefined) => void,
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

export function PositionForm({
  sites,
  pinnedSiteName,
  position,
  onSaved,
}: {
  // Site masters for the site pick, already scoped per role by the page
  // (superadmin: all sites, ho: their one, admin: their binding's).
  sites: SiteOption[];
  // An admin actor's site — their select is pinned (server-side override),
  // so it renders disabled with their binding's site name. Undefined for
  // ho/superadmin.
  pinnedSiteName?: string;
  position?: PositionRow;
  onSaved: () => void;
}) {
  const [siteId, setSiteId] = useState<string | null>(
    position?.siteId ?? (sites.length === 1 ? sites[0].id : null),
  );
  const [name, setName] = useState(position?.name ?? "");
  const [fieldErrors, setFieldErrors] = useState<PositionFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const isEdit = !!position;
  // The site pick renders for a superadmin with a real choice; a ho (one
  // site) gets none, and an admin's pick is pinned. Whatever the client
  // sends, the action re-pins ho/admin server-side — the value is display
  // sugar for those two roles.
  const showSiteSelect = pinnedSiteName === undefined && sites.length > 1;
  const siteItems: SelectOption[] =
    pinnedSiteName !== undefined
      ? [{ label: pinnedSiteName, value: siteId ?? "", disabled: true }]
      : toSelectItems(sites, "Select a site");
  const siteValue =
    pinnedSiteName !== undefined ? (position?.siteId ?? siteId) : siteId;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // Pre-submit site guard (mirrors the work-area form's): a position must
    // bind a site; a missing pick surfaces the local field error and skips
    // the server action entirely.
    if (!siteValue) {
      setFieldErrors({ siteId: "Site is required" });
      return;
    }

    startTransition(async () => {
      // Absent optional selects submit undefined, never null/"" — the uuid
      // validators would turn a null into a misleading per-field error.
      const result = isEdit
        ? await updatePosition(position.id, {
            name,
            isActive: position.isActive,
          })
        : await createPosition({
            siteId: siteValue ?? undefined,
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

        {showSiteSelect || pinnedSiteName !== undefined ? (
          <SelectField
            id="position-site"
            label="Site"
            items={siteItems}
            value={siteValue}
            disabled={pinnedSiteName !== undefined}
            onChange={setSiteId}
            error={fieldErrors?.siteId}
          />
        ) : null}

        <Field data-invalid={fieldErrors?.name ? "true" : undefined}>
          <FieldLabel htmlFor="position-name">Position name</FieldLabel>
          <Input
            id="position-name"
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

export function CreatePositionButton({
  sites,
  pinnedSiteName,
}: {
  sites: SiteOption[];
  pinnedSiteName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <BriefcaseIcon data-icon="inline-start" />
        Add position
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New position</DialogTitle>
          <DialogDescription>
            Positions are the job roles inside a site that workers get
            assigned to.
          </DialogDescription>
        </DialogHeader>
        <PositionForm
          sites={sites}
          pinnedSiteName={pinnedSiteName}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function PositionRowActions({
  position,
  sites,
  pinnedSiteName,
}: {
  position: PositionRow;
  sites: SiteOption[];
  pinnedSiteName?: string;
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
            aria-label={`Actions for ${position.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={pending}
            variant={position.isActive ? "destructive" : undefined}
            onClick={() => setDialog("toggle")}
          >
            <PowerIcon />
            {position.isActive ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <RowDeleteItem
            isActive={position.isActive}
            onOpen={() => setDialog("delete")}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialogs live outside the menu popup so the menu can
      close before their layer opens. */}
      <EditPositionDialog
        position={position}
        sites={sites}
        pinnedSiteName={pinnedSiteName}
        open={dialog === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <DeletePositionDialog
        position={position}
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <TogglePositionDialog
        position={position}
        open={dialog === "toggle"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function TogglePositionDialog({
  position,
  open,
  onOpenChange,
}: {
  position: PositionRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const activating = !position.isActive;
  const verb = activating ? "Activate" : "Deactivate";

  function handleConfirm() {
    startTransition(async () => {
      const result = await togglePosition(position.id);
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
            {verb} “{position.name}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The position will be marked {activating ? "active" : "inactive"}.
            Nothing else changes.
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

function EditPositionDialog({
  position,
  sites,
  pinnedSiteName,
  open,
  onOpenChange,
}: {
  position: PositionRow;
  sites: SiteOption[];
  pinnedSiteName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit position</DialogTitle>
          <DialogDescription>
            Update the position&apos;s name or status.
          </DialogDescription>
        </DialogHeader>
        <PositionForm
          sites={sites}
          pinnedSiteName={pinnedSiteName}
          position={position}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeletePositionDialog({
  position,
  open,
  onOpenChange,
}: {
  position: PositionRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deletePosition(position.id);
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
          <AlertDialogTitle>Delete position</AlertDialogTitle>
          <AlertDialogDescription>
            “{position.name}” will be hidden from the list.
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
