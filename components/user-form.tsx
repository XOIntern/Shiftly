"use client";

import { useId, useState, useTransition } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { createUser, setActive, updateUser } from "@/app/(dashboard)/users/actions";
import type { ActionState } from "@/lib/action-state";
import { GENERIC_ERROR } from "@/lib/action-state";
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

export type SiteOption = { id: string; name: string };

// One row of the users table — server-selectable fields only.
export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ho" | "site_admin";
  siteId: string | null;
  siteName: string | null;
  isActive: boolean;
};

const roleItems = [
  { label: "Head office", value: "ho" },
  { label: "Site admin", value: "site_admin" },
];

function UserForm({
  user,
  sites,
  onSaved,
}: {
  // Present for edits, absent for creates.
  user?: UserRow;
  sites: SiteOption[];
  onSaved: () => void;
}) {
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const roleId = useId();
  const siteId = useId();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string | null>(user?.role ?? null);
  const [site, setSite] = useState<string | null>(user?.siteId ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>();
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const siteItems: { label: string; value: string | null; disabled?: boolean }[] = [
    { label: "Select a site", value: null, disabled: true },
    ...sites.map(({ id, name }) => ({ label: name, value: id })),
  ];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFieldErrors(undefined);
    setMessage(undefined);
    startTransition(async () => {
      let result: ActionState;
      if (user) {
        result = await updateUser(user.id, {
          name,
          role: role ?? user.role,
          siteId: site,
        });
      } else {
        const createRole = role ?? "site_admin";
        result = await createUser({
          name,
          email,
          password,
          role: createRole,
          // ho never carries a site in the create payload; a null siteId
          // would otherwise hit the schema's siteId uuid rule invisibly.
          ...(createRole === "ho" ? {} : { siteId: site }),
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
        {!user ? (
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
            onValueChange={(value) => {
              setRole(value as string | null);
              // ho users never carry a site; drop a stale site selection so
              // the refine can't reject the switch for a now-irrelevant site.
              if (value === "ho") setSite(null);
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
        {role === "site_admin" ? (
          <Field data-invalid={fieldErrors?.siteId ? "true" : undefined}>
            <FieldLabel htmlFor={siteId}>Site</FieldLabel>
            <Select
              items={siteItems}
              value={site}
              onValueChange={(value) => setSite(value as string | null)}
            >
              <SelectTrigger id={siteId} className="w-full">
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
                No sites yet — create one before adding a site admin.
              </FieldDescription>
            ) : null}
            {fieldErrors?.siteId ? (
              <FieldError errors={[{ message: fieldErrors.siteId }]} />
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

export function CreateUserButton({ sites }: { sites: SiteOption[] }) {
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
            Head-office users run the whole system; site admins only see their
            one site.
          </DialogDescription>
        </DialogHeader>
        <UserForm sites={sites} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function EditUserButton({
  user,
  sites,
}: {
  user: UserRow;
  sites: SiteOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${user.name}`}
          />
        }
      >
        <PencilIcon />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>
            Change the role or site binding of “{user.name}”.
          </DialogDescription>
        </DialogHeader>
        <UserForm user={user} sites={sites} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function ToggleUserButton({ user }: { user: UserRow }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await setActive(user.id, !user.isActive);
          if (!result.ok) toast.error(result.message ?? GENERIC_ERROR);
        });
      }}
    >
      {user.isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
