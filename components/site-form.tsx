"use client";

import { useState, useTransition } from "react";
import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";

import type { ActionState } from "@/lib/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
import { createSite, deleteSite, toggleSite, updateSite } from "@/app/(dashboard)/sites/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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

export type ClientOption = { id: string; name: string };

// One row of the sites table — server-selectable fields only.
export type SiteRow = {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  location: string;
  isActive: boolean;
};

type SiteFieldErrors = Record<string, string>;

type SelectOption = {
  label: string;
  value: string | null;
  disabled?: boolean;
};

function showFailure(
  result: ActionState,
  setErrors: (value: SiteFieldErrors | undefined) => void,
  setMessage: (value: string) => void,
) {
  if (result.fieldErrors) setErrors(result.fieldErrors);
  if (result.message) setMessage(result.message);
}

function SiteForm({
  clients,
  site,
  onSaved,
}: {
  clients: ClientOption[];
  site?: SiteRow;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState<string | null>(site?.clientId ?? null);
  const [name, setName] = useState(site?.name ?? "");
  const [location, setLocation] = useState(site?.location ?? "");
  const [fieldErrors, setFieldErrors] = useState<SiteFieldErrors>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const selectItems: SelectOption[] = [
    ...(site
      ? []
      : [{ label: "Select a client", value: null, disabled: true }]),
    ...clients.map((client) => ({ label: client.name, value: client.id })),
  ];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const result = site
        ? await updateSite(site.id, {
            name,
            location,
            clientId: clientId ?? "",
            isActive: site.isActive,
          })
        : await createSite(clientId ?? "", name, location);

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
        <Field data-invalid={fieldErrors?.location ? "true" : undefined}>
          <FieldLabel htmlFor="site-location">Location</FieldLabel>
          <Input
            id="site-location"
            name="location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            aria-invalid={fieldErrors?.location ? true : undefined}
            maxLength={200}
            required
          />
          {fieldErrors?.location ? (
            <FieldError errors={[{ message: fieldErrors.location }]} />
          ) : null}
        </Field>
        <Field data-invalid={fieldErrors?.clientId ? "true" : undefined}>
          <FieldLabel htmlFor="site-client">Client</FieldLabel>
          <Select
            items={selectItems}
            value={clientId}
            onValueChange={(value) => setClientId(value as string | null)}
          >
            <SelectTrigger id="site-client" className="w-full">
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
          {clients.length === 0 ? (
            <FieldDescription>
              No clients yet — create one before adding its first site.
            </FieldDescription>
          ) : null}
          {fieldErrors?.clientId ? (
            <FieldError errors={[{ message: fieldErrors.clientId }]} />
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

export function CreateSiteButton({ clients }: { clients: ClientOption[] }) {
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
        <SiteForm clients={clients} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function EditSiteButton({
  site,
  clients,
}: {
  site: SiteRow;
  clients: ClientOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${site.name}`}
          />
        }
      >
        <PencilIcon />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit site</DialogTitle>
          <DialogDescription>
            Update the site&apos;s details or move it to another client.
          </DialogDescription>
        </DialogHeader>
        <SiteForm clients={clients} site={site} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function ToggleSiteButton({ site }: { site: SiteRow }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await toggleSite(site.id);
          if (!result.ok) toast.error(result.message ?? GENERIC_ERROR);
        });
      }}
    >
      {site.isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}

export function DeleteSiteButton({ site }: { site: SiteRow }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteSite(site.id);
      if (result.ok) {
        setOpen(false);
        return;
      }
      toast.error(result.message ?? GENERIC_ERROR);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${site.name}`}
          />
        }
      >
        <TrashIcon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete site</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes “{site.name}”. Sites referenced by users
            cannot be deleted.
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
