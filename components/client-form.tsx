"use client";

import { useId, useState } from "react";
import { useActionState } from "react";

import { createClient, renameClient } from "@/app/(dashboard)/clients/actions";
import type { ActionState } from "@/lib/action-state";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PlusIcon } from "lucide-react";

type ClientFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initialName: string;
  submitAction: (formState: ActionState, name: string) => Promise<ActionState>;
  trigger: React.ReactElement;
};

function ClientFormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName,
  submitAction,
  trigger,
}: ClientFormDialogProps) {
  const inputId = useId();
  const [name, setName] = useState(initialName);

  const handleOpenChange = (next: boolean) => {
    // Reset for the next open.
    if (!next) setName(initialName);
    onOpenChange(next);
  };

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (_formState, formData) => {
      const result = await submitAction(_formState, String(formData.get("name") ?? ""));
      if (result.ok) handleOpenChange(false);
      return result;
    },
    { ok: false }
  );

  const nameError = state.fieldErrors?.name;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={formAction}>
          <FieldGroup>
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor={inputId}>Name</FieldLabel>
              <Input
                id={inputId}
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={nameError ? true : undefined}
              />
              {nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            {state.message && <p className="text-sm text-destructive">{state.message}</p>}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateClientDialog() {
  const [open, setOpen] = useState(false);

  return (
    <ClientFormDialog
      open={open}
      onOpenChange={setOpen}
      title="New client"
      description="Clients sit above sites; add sites and users afterwards."
      submitLabel="Create client"
      initialName=""
      submitAction={createClient}
      trigger={
        <Button>
          <PlusIcon data-icon="inline-start" />
          New client
        </Button>
      }
    />
  );
}

export function RenameClientDialog({ client }: { client: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);

  return (
    <ClientFormDialog
      open={open}
      onOpenChange={setOpen}
      title="Rename client"
      description={`Change the name of “${client.name}”.`}
      submitLabel="Save"
      initialName={client.name}
      submitAction={(formState, name) => renameClient(client.id, name)}
      trigger={
        <Button variant="ghost" size="sm">
          Rename
        </Button>
      }
    />
  );
}
