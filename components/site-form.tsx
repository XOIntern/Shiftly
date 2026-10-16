"use client";

import { useState, useTransition } from "react";
import {
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/lib/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import {
  createSite,
  deleteSite,
  toggleSite,
  updateSite,
} from "@/app/dashboard/sites/actions";
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

// One row of the sites table — server-selectable fields only.
export type SiteRow = {
  id: string;
  name: string;
  isActive: boolean;
};

type SiteFieldErrors = Record<string, string>;

function showFailure(
  result: ActionState,
  setErrors: (value: SiteFieldErrors | undefined) => void,
  setMessage: (value: string) => void,
) {
  if (result.fieldErrors) setErrors(result.fieldErrors);
  if (result.message) setMessage(result.message);
}

function SiteForm({ site, onSaved }: { site?: SiteRow; onSaved: () => void }) {
  const [name, setName] = useState(site?.name ?? "");
  const [fieldErrors, setFieldErrors] = useState<SiteFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const result = site
        ? await updateSite(site.id, { name, isActive: site.isActive })
        : await createSite(name);

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
        <Field data-invalid={fieldErrors?.name ? "true" : undefined}>
          <FieldLabel htmlFor="site-name">Site name</FieldLabel>
          <Input
            id="site-name"
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

export function CreateSiteButton() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        Add site
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New site</DialogTitle>
          <DialogDescription>
            Sites are the operational locations workers get rostered at.
          </DialogDescription>
        </DialogHeader>
        <SiteForm onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function SiteRowActions({ site }: { site: SiteRow }) {
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      const result = await toggleSite(site.id);
      if (!result.ok) toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${site.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={pending} onClick={toggleActive}>
            <PowerIcon />
            {site.isActive ? "Deactivate" : "Activate"}
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
      <EditSiteDialog
        site={site}
        open={dialog === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <DeleteSiteDialog
        site={site}
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function EditSiteDialog({
  site,
  open,
  onOpenChange,
}: {
  site: SiteRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit site</DialogTitle>
          <DialogDescription>
            Update the site&apos;s name or change its active state.
          </DialogDescription>
        </DialogHeader>
        <SiteForm site={site} onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DeleteSiteDialog({
  site,
  open,
  onOpenChange,
}: {
  site: SiteRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteSite(site.id);
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
          <AlertDialogTitle>Delete site</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes “{site.name}”. Sites that still have
            locations or bound users cannot be deleted.
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
