"use client";

import { useId, useState, useTransition } from "react";
import {
  EllipsisIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  createUser,
  setActive,
  updateUser,
} from "@/app/dashboard/users/actions";
import { GENERIC_ERROR } from "@/lib/action-state";
import type { ActionState } from "@/lib/action-state";
import type { Role } from "@/lib/scope";
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
import { ResetPasswordDialog } from "@/components/user-reset-password";
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

// Role comes from lib/scope (single source of truth, shared with the
// actions); the dialog only renders the select from it.

export type SiteOption = { id: string; name: string };

// siteName can be null only through the left join that produces the list;
// the select label falls back to the bare location name.
export type LocationOption = {
  id: string;
  name: string;
  siteId: string;
  siteName: string | null;
};

// One row of the users table — server-selectable fields only.
export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  binding: string | null;
  isActive: boolean;
};

// Edit dialog data — the raw bindings the form pre-fills from.
export type UserFormData = {
  id: string;
  name: string;
  role: Role;
  siteId: string | null;
  siteLocationId: string | null;
};

const roleItemsAll: { label: string; value: Role }[] = [
  { label: "Superadmin", value: "superadmin" },
  { label: "Head Office (HO)", value: "ho" },
  { label: "Admin", value: "admin" },
];

function UserForm({
  mode,
  actorRole,
  user,
  sites,
  locations,
  onSaved,
}: {
  mode: "create" | "edit";
  actorRole: Role;
  // Present for edits, absent for creates.
  user?: UserFormData;
  sites: SiteOption[];
  locations: LocationOption[];
  onSaved: () => void;
}) {
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const roleId = useId();
  const siteFieldId = useId();
  const locationFieldId = useId();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // ho actors force the admin role; a superadmin actor starts unassigned.
  const [role, setRole] = useState<Role | null>(
    user?.role ?? (actorRole === "ho" ? "admin" : null),
  );
  const [site, setSite] = useState<string | null>(user?.siteId ?? null);
  const [location, setLocation] = useState<string | null>(
    user?.siteLocationId ?? null,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Role items follow the actor: a superadmin picks any of the three roles,
  // an ho actor provisions admins only.
  const roleItems =
    actorRole === "superadmin"
      ? roleItemsAll
      : roleItemsAll.filter((item) => item.value === "admin");

  // An ho actor cannot change a binding on edit (the action pins it), so
  // the location select renders disabled there; creation keeps it editable
  // because choosing the location is the point.
  const locationLocked = mode === "edit" && actorRole === "ho";

  const siteItems: {
    label: string;
    value: string | null;
    disabled?: boolean;
  }[] = [
    { label: "Select a site", value: null, disabled: true },
    ...sites.map(({ id, name }) => ({ label: name, value: id })),
  ];

  const locationItems: {
    label: string;
    value: string | null;
    disabled?: boolean;
  }[] = [
    { label: "Select a location", value: null, disabled: true },
    ...locations.map(({ id, name, siteName }) => ({
      label: siteName ? `${name} (${siteName})` : name,
      value: id,
    })),
  ];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);

    // Pre-submit binding guard: a role that must carry a binding and has
    // none never reaches the server action — the roundtrip would answer
    // with a form-level refine error instead of a field error. Unselected
    // selects must not submit at all.
    const bindingErrors: Record<string, string> = {};
    if (role === "ho" && !site) {
      bindingErrors.siteId = "Site is required";
    }
    if (role === "admin" && !location) {
      bindingErrors.siteLocationId = "Location is required";
    }
    if (Object.keys(bindingErrors).length > 0) {
      setFieldErrors(bindingErrors);
      return;
    }

    startTransition(async () => {
      let result: ActionState;
      if (user) {
        result = await updateUser(user.id, {
          name,
          role: role ?? user.role,
          // Only the binding the final role owns goes out; unrendered
          // selects stay out of the payload (undefined, never "").
          ...(role === "ho" ? { siteId: site ?? undefined } : {}),
          ...(role === "admin"
            ? { siteLocationId: location ?? undefined }
            : {}),
        });
      } else {
        const createRole = role ?? "admin";
        result = await createUser({
          name,
          email,
          password,
          role: createRole,
          ...(createRole === "ho" ? { siteId: site ?? undefined } : {}),
          ...(createRole === "admin"
            ? { siteLocationId: location ?? undefined }
            : {}),
        });
      }

      if (result.ok) {
        onSaved();
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.message) setMessage(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-4">
        {message ? <FieldError>{message}</FieldError> : null}
        {fieldErrors?.form ? <FieldError>{fieldErrors.form}</FieldError> : null}
        <Field data-invalid={fieldErrors?.name ? "true" : undefined}>
          <FieldLabel htmlFor={nameId}>Name</FieldLabel>
          <Input
            id={nameId}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={fieldErrors?.name ? true : undefined}
            maxLength={100}
            required
          />
          {fieldErrors?.name ? (
            <FieldError errors={[{ message: fieldErrors.name }]} />
          ) : null}
        </Field>
        {mode === "create" ? (
          <>
            <Field data-invalid={fieldErrors?.email ? "true" : undefined}>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                id={emailId}
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={fieldErrors?.email ? true : undefined}
                required
              />
              {fieldErrors?.email ? (
                <FieldError errors={[{ message: fieldErrors.email }]} />
              ) : null}
            </Field>
            <Field data-invalid={fieldErrors?.password ? "true" : undefined}>
              <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
              <Input
                id={passwordId}
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={fieldErrors?.password ? true : undefined}
                minLength={8}
                required
              />
              <FieldDescription>At least 8 characters.</FieldDescription>
              {fieldErrors?.password ? (
                <FieldError errors={[{ message: fieldErrors.password }]} />
              ) : null}
            </Field>
          </>
        ) : null}
        <Field data-invalid={fieldErrors?.role ? "true" : undefined}>
          <FieldLabel htmlFor={roleId}>Role</FieldLabel>
          <Select
            items={roleItems}
            value={role}
            disabled={actorRole === "ho"}
            onValueChange={(value) => {
              setRole(value as Role | null);
              // A role switch swaps the binding widget; drop the stale
              // selections so the refine can't reject the move for a
              // now-irrelevant binding.
              setSite(null);
              setLocation(null);
            }}
          >
            <SelectTrigger id={roleId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {roleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {fieldErrors?.role ? (
            <FieldError errors={[{ message: fieldErrors.role }]} />
          ) : null}
        </Field>
        {role === "ho" && actorRole === "superadmin" ? (
          // Site binding for ho users — only a superadmin actor manages
          // ho users, so only their dialog renders this select.
          <Field data-invalid={fieldErrors?.siteId ? "true" : undefined}>
            <FieldLabel htmlFor={siteFieldId}>Site</FieldLabel>
            <Select
              items={siteItems}
              value={site}
              onValueChange={(value) => setSite(value as string | null)}
            >
              <SelectTrigger id={siteFieldId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {siteItems.map((item) => (
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
                No sites yet — create one before adding a head-office user.
              </FieldDescription>
            ) : null}
            {fieldErrors?.siteId ? (
              <FieldError errors={[{ message: fieldErrors.siteId }]} />
            ) : null}
          </Field>
        ) : null}
        {role === "admin" ? (
          <Field
            data-invalid={fieldErrors?.siteLocationId ? "true" : undefined}
          >
            <FieldLabel htmlFor={locationFieldId}>Location</FieldLabel>
            <Select
              items={locationItems}
              value={location}
              disabled={locationLocked}
              onValueChange={(value) => setLocation(value as string | null)}
            >
              <SelectTrigger id={locationFieldId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {locationItems.map((item) => (
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
            {locationLocked ? (
              <FieldDescription>
                The location is fixed after creation.
              </FieldDescription>
            ) : null}
            {locations.length === 0 ? (
              <FieldDescription>
                No locations yet — create one before adding an admin.
              </FieldDescription>
            ) : null}
            {fieldErrors?.siteLocationId ? (
              <FieldError errors={[{ message: fieldErrors.siteLocationId }]} />
            ) : null}
          </Field>
        ) : null}
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function CreateUserButton({
  actorRole,
  sites,
  locations,
}: {
  actorRole: Role;
  sites: SiteOption[];
  locations: LocationOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        New user
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            Superadmins run the whole system; head-office users bind one site;
            admins bind one site location.
          </DialogDescription>
        </DialogHeader>
        <UserForm
          mode="create"
          actorRole={actorRole}
          sites={sites}
          locations={locations}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function UserRowActions({
  user,
  form,
  actorRole,
  sites,
  locations,
}: {
  user: UserRow;
  form: UserFormData;
  actorRole: Role;
  sites: SiteOption[];
  locations: LocationOption[];
}) {
  const [dialog, setDialog] = useState<"edit" | "reset" | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      const result = await setActive(user.id, !user.isActive);
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
            aria-label={`Actions for ${user.name}`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={pending} onClick={toggleActive}>
            <PowerIcon />
            {user.isActive ? "Deactivate" : "Activate"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("reset")}>
            <KeyRoundIcon />
            Reset password
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
      {/* Controlled dialogs live outside the menu popup so the menu can
      close before their layer opens. */}
      <EditUserDialog
        actorRole={actorRole}
        user={form}
        sites={sites}
        locations={locations}
        open={dialog === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <ResetPasswordDialog
        user={user}
        open={dialog === "reset"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function EditUserDialog({
  actorRole,
  user,
  sites,
  locations,
  open,
  onOpenChange,
}: {
  actorRole: Role;
  user: UserFormData;
  sites: SiteOption[];
  locations: LocationOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>
            Change the role or binding of “{user.name}”.
          </DialogDescription>
        </DialogHeader>
        <UserForm
          mode="edit"
          actorRole={actorRole}
          user={user}
          sites={sites}
          locations={locations}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
