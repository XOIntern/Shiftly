"use client";

import { useId, useState, useTransition } from "react";
import {
  EllipsisIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  createUser,
  deleteUser,
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
import { ResetPasswordDialog } from "@/components/users/user-reset-password";
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

// Departments/work areas (issue #66): mirrors the site/location options.
// Work-area rows key on the site_location so the select can shrink to the
// target admin's chosen location; the page pre-scopes both option lists.
export type DepartmentOption = { id: string; name: string; siteId: string };

export type WorkAreaOption = {
  id: string;
  name: string;
  siteLocationId: string;
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
  departmentId: string | null;
  workAreaId: string | null;
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
  departments,
  workAreas,
  onSaved,
}: {
  mode: "create" | "edit";
  actorRole: Role;
  // Present for edits, absent for creates.
  user?: UserFormData;
  sites: SiteOption[];
  locations: LocationOption[];
  departments: DepartmentOption[];
  workAreas: WorkAreaOption[];
  onSaved: () => void;
}) {
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const roleId = useId();
  const siteFieldId = useId();
  const locationFieldId = useId();
  const departmentFieldId = useId();
  const workAreaFieldId = useId();

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
  const [department, setDepartment] = useState<string | null>(
    user?.departmentId ?? null,
  );
  const [workArea, setWorkArea] = useState<string | null>(
    user?.workAreaId ?? null,
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
  // because choosing the location is the point. The department is NOT
  // pinned this way: the action lets an ho pick their own site's
  // department on an edit (issue #66 golden path) — the select stays
  // usable and the payload's departmentId is sent as-is.
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
      label: siteName ? `${siteName} (${name})` : name,
      value: id,
    })),
  ];

  // A department is site-scoped: for an ho target the pick must match the
  // site select; for an admin the page already scopes the options.
  const departmentItems: {
    label: string;
    value: string | null;
    disabled?: boolean;
  }[] = [
    { label: "Select a department", value: null, disabled: true },
    ...departments
      .filter((option) => (role === "ho" ? option.siteId === site : true))
      .map(({ id, name }) => ({ label: name, value: id })),
  ];

  // Work areas key off the admin's chosen site_location (issue #66): the
  // list shrinks as the location select moves.
  const workAreaItems: {
    label: string;
    value: string | null;
    disabled?: boolean;
  }[] = [
    { label: "Select a work area", value: null, disabled: true },
    ...workAreas
      .filter((option) => option.siteLocationId === location)
      .map(({ id, name }) => ({ label: name, value: id })),
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
          ...(role === "admin" || role === "ho"
            ? { departmentId: department ?? undefined }
            : {}),
          ...(role === "admin" && actorRole === "superadmin"
            ? { workAreaId: workArea ?? undefined }
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
          ...(createRole === "admin" || createRole === "ho"
            ? { departmentId: department ?? undefined }
            : {}),
          ...(createRole === "admin" && actorRole === "superadmin"
            ? { workAreaId: workArea ?? undefined }
            : {}),
        });
      }

      if (result.ok) {
        onSaved();
        return;
      }
      if (result.fieldErrors) {
        // Errors for keys without a rendered field (id, form-level parse
        // messages) would vanish otherwise: lift them into the message slot.
        const known = ["name", "email", "password", "role", "siteId", "siteLocationId", "departmentId", "workAreaId", "form"];
        const stray = Object.entries(result.fieldErrors).filter(
          ([key]) => !known.includes(key),
        );
        if (stray.length > 0) {
          setMessage(stray.map(([, value]) => value).join(". "));
        }
        setFieldErrors(result.fieldErrors);
      }
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
              setDepartment(null);
              setWorkArea(null);
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
              onValueChange={(value) => {
                setLocation(value as string | null);
                // A location move invalidates the work-area pick.
                setWorkArea(null);
              }}
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
        {role === "superadmin" || role === null ? null : (
          // Department binding (issue #66): any ho or admin target may
          // carry one. An ho target's departments shrink to the chosen
          // site; an admin target's arrive pre-scoped from the page.
          <Field
            data-invalid={fieldErrors?.departmentId ? "true" : undefined}
          >
            <FieldLabel htmlFor={departmentFieldId}>Department</FieldLabel>
            <Select
              items={departmentItems}
              value={department}
              onValueChange={(value) => setDepartment(value as string | null)}
            >
              <SelectTrigger id={departmentFieldId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {departmentItems.map((item) => (
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
            {departmentItems.length === 1 ? (
              <FieldDescription>
                No departments available — create one first.
              </FieldDescription>
            ) : null}
            {fieldErrors?.departmentId ? (
              <FieldError errors={[{ message: fieldErrors.departmentId }]} />
            ) : null}
          </Field>
        )}
        {role === "admin" && actorRole === "superadmin" ? (
          // Work-area binding (issue #66): admins only, superadmin-managed
          // — an ho actor never sets one (the action strips it). Options
          // key on the target admin's chosen location.
          <Field
            data-invalid={fieldErrors?.workAreaId ? "true" : undefined}
          >
            <FieldLabel htmlFor={workAreaFieldId}>Work area</FieldLabel>
            <Select
              items={workAreaItems}
              value={workArea}
              onValueChange={(value) => setWorkArea(value as string | null)}
            >
              <SelectTrigger id={workAreaFieldId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {workAreaItems.map((item) => (
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
            {workAreaItems.length === 1 ? (
              <FieldDescription>
                No work areas at this location yet — create one first.
              </FieldDescription>
            ) : null}
            {fieldErrors?.workAreaId ? (
              <FieldError errors={[{ message: fieldErrors.workAreaId }]} />
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
  departments,
  workAreas,
}: {
  actorRole: Role;
  sites: SiteOption[];
  locations: LocationOption[];
  departments: DepartmentOption[];
  workAreas: WorkAreaOption[];
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
          departments={departments}
          workAreas={workAreas}
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
  departments,
  workAreas,
}: {
  user: UserRow;
  form: UserFormData;
  actorRole: Role;
  sites: SiteOption[];
  locations: LocationOption[];
  departments: DepartmentOption[];
  workAreas: WorkAreaOption[];
}) {
  const [dialog, setDialog] = useState<
    "edit" | "reset" | "toggle" | "delete" | null
  >(null);
  const [pending] = useTransition();

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
          <DropdownMenuItem
            disabled={pending}
            variant={user.isActive ? "destructive" : undefined}
            onClick={() => setDialog("toggle")}
          >
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
      <EditUserDialog
        actorRole={actorRole}
        user={form}
        sites={sites}
        locations={locations}
        departments={departments}
        workAreas={workAreas}
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
      <ToggleUserDialog
        user={user}
        open={dialog === "toggle"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <DeleteUserDialog
        user={user}
        open={dialog === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </DropdownMenu>
  );
}

function ToggleUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const activating = !user.isActive;
  const verb = activating ? "Activate" : "Deactivate";

  function handleConfirm() {
    startTransition(async () => {
      const result = await setActive(user.id, activating);
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
            {verb} “{user.name}”?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {activating
              ? "They will be able to sign in again."
              : "They will no longer be able to sign in, and all their signed-in devices will be logged out."}
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

function EditUserDialog({
  actorRole,
  user,
  sites,
  locations,
  departments,
  workAreas,
  open,
  onOpenChange,
}: {
  actorRole: Role;
  user: UserFormData;
  sites: SiteOption[];
  locations: LocationOption[];
  departments: DepartmentOption[];
  workAreas: WorkAreaOption[];
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
          departments={departments}
          workAreas={workAreas}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteUser(user.id);
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
          <AlertDialogTitle>Delete “{user.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. The account will be hidden from the list,
            and all signed-in devices will be logged out.
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
