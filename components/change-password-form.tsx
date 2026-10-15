"use client";

import { useId, useState, useTransition } from "react";

import { changePassword } from "@/app/(dashboard)/settings/actions";
import type { ActionState } from "@/lib/action-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InfoIcon, Loader2Icon } from "lucide-react";

export function ChangePasswordForm() {
  const currentId = useId();
  const newId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ActionState["fieldErrors"]>();
  const [message, setMessage] = useState<string>();
  const [succeeded, setSucceeded] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);
    setSucceeded(false);
    startTransition(async () => {
      const result = await changePassword(currentPassword, newPassword);
      if (result.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setSucceeded(true);
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.message) setMessage(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="max-w-sm gap-4">
        {message ? (
          <Alert variant="destructive" role="alert">
            <InfoIcon />
            <AlertTitle>{message}</AlertTitle>
          </Alert>
        ) : null}
        {succeeded ? (
          <p className="text-sm text-muted-foreground">Password changed.</p>
        ) : null}
        <Field data-invalid={fieldErrors?.currentPassword ? "true" : undefined}>
          <FieldLabel htmlFor={currentId}>Current password</FieldLabel>
          <Input
            id={currentId}
            name="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          {fieldErrors?.currentPassword ? (
            <FieldError errors={[{ message: fieldErrors.currentPassword }]} />
          ) : null}
        </Field>
        <Field data-invalid={fieldErrors?.newPassword ? "true" : undefined}>
          <FieldLabel htmlFor={newId}>New password</FieldLabel>
          <Input
            id={newId}
            name="newPassword"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
          {fieldErrors?.newPassword ? (
            <FieldError errors={[{ message: fieldErrors.newPassword }]} />
          ) : null}
        </Field>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          {pending ? "Saving…" : "Save new password"}
        </Button>
      </FieldGroup>
    </form>
  );
}
