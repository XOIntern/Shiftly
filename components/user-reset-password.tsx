"use client";

import { useId, useState, useTransition } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { resetPassword } from "@/app/dashboard/users/actions";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupInput, InputGroupAddon } from "./ui/input-group";

export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputId = useId();
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ActionState["fieldErrors"]>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    // Reset for the next open.
    if (!next) {
      setNewPassword("");
      setShowPassword(false);
      setFieldErrors(undefined);
      setMessage(undefined);
    }
    onOpenChange(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);
    startTransition(async () => {
      const result = await resetPassword(user.id, newPassword);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.message) setMessage(result.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for “{user.name}”. Their current password stops
            working immediately. All their signed-in devices will be logged out.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup className="gap-4">
            {message ? <FieldError>{message}</FieldError> : null}
            <Field data-invalid={fieldErrors?.newPassword ? "true" : undefined}>
              <FieldLabel htmlFor={inputId}>New password</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id={inputId}
                  name="newPassword"
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-invalid={fieldErrors?.newPassword ? true : undefined}
                  minLength={8}
                  required
                />
                <InputGroupAddon align="inline-end">
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    tabIndex={-1}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>At least 8 characters.</FieldDescription>
              {fieldErrors?.newPassword ? (
                <FieldError errors={[{ message: fieldErrors.newPassword }]} />
              ) : null}
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Reset password"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
