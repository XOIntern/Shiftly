"use client";

import { useId, useState, useTransition } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { resetPassword } from "@/app/dashboard/users/actions";
import type { ActionState } from "@/types/action-state";
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
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group";

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ActionState["fieldErrors"]>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    // Reset for the next open.
    if (!next) {
      setNewPassword("");
      setShowPassword(false);
      setConfirmOpen(false);
      setFieldErrors(undefined);
      setMessage(undefined);
    }
    onOpenChange(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (pending) return;
    startTransition(async () => {
      const result = await resetPassword(user.id, newPassword);
      if (result.ok) {
        handleOpenChange(false);
        return;
      }
      setConfirmOpen(false);
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.message) setMessage(result.message);
    });
  }

  return (
    <>
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
                  minLength={15}
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
              <FieldDescription>At least 15 characters.</FieldDescription>
              {fieldErrors?.newPassword ? (
                <FieldError errors={[{ message: fieldErrors.newPassword }]} />
              ) : null}
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Reset password
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password for “{user.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Their current password stops working immediately and all their
              signed-in devices will be logged out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={pending} onClick={handleConfirm}>
              {pending ? "Resetting…" : "Reset password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
