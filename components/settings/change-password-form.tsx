"use client";

import { useId, useState, useTransition } from "react";

import { changePassword } from "@/app/dashboard/settings/actions";
import type { ActionState } from "@/lib/action-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupInput, InputGroupAddon } from "../ui/input-group";
import { EyeIcon, EyeOffIcon, InfoIcon, Loader2Icon } from "lucide-react";

export function ChangePasswordForm() {
  const currentId = useId();
  const newId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ActionState["fieldErrors"]>();
  const [message, setMessage] = useState<string>();
  const [succeeded, setSucceeded] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
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
      <FieldGroup className="max-w-xl gap-4">
        {message ? (
          <Alert variant="destructive" role="alert">
            <InfoIcon />
            <AlertTitle>{message}</AlertTitle>
          </Alert>
        ) : null}
        {succeeded ? (
          <p className="text-sm text-muted-foreground">
            Password changed. Other devices have been signed out.
          </p>
        ) : null}
        <Field data-invalid={fieldErrors?.currentPassword ? "true" : undefined}>
          <FieldLabel htmlFor={currentId}>Current password</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={currentId}
              name="currentPassword"
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
            <InputGroupAddon align="inline-end">
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Hide password" : "Show password"}
                aria-pressed={showCurrent}
                tabIndex={-1}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {showCurrent ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </InputGroupAddon>
          </InputGroup>
          {fieldErrors?.currentPassword ? (
            <FieldError errors={[{ message: fieldErrors.currentPassword }]} />
          ) : null}
        </Field>
        <Field data-invalid={fieldErrors?.newPassword ? "true" : undefined}>
          <FieldLabel htmlFor={newId}>New password</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={newId}
              name="newPassword"
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <InputGroupAddon align="inline-end">
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Hide password" : "Show password"}
                aria-pressed={showNew}
                tabIndex={-1}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {showNew ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </InputGroupAddon>
          </InputGroup>
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
